package ui

import (
	"fmt"
	"sort"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kargnas/tmux-worktree-tui/pkg/config"
	"github.com/kargnas/tmux-worktree-tui/pkg/discovery"
	"github.com/kargnas/tmux-worktree-tui/pkg/git"
	"github.com/kargnas/tmux-worktree-tui/pkg/naming"
	"github.com/kargnas/tmux-worktree-tui/pkg/recent"
	"github.com/kargnas/tmux-worktree-tui/pkg/tmux"
)

// --- Enums & Constants ---

type state int

const (
	stateProjectList state = iota
	stateWorktreeList
	stateAddPath
)

type TabType int

const (
	TabAllProjects TabType = iota
	TabActiveSessions
)

var tabTitles = []string{"All Projects", "Active Sessions"}

type SortType int

const (
	SortByRecent SortType = iota
	SortByName
	SortByActive
)

var sortNames = []string{"Recent", "Name", "Active"}

// --- Return Value ---

type AttachAction struct {
	SessionName string
	Cwd         string
}

// --- KeyMap ---

type keyMap struct {
	Sort    key.Binding
	Filter  key.Binding
	AddPath key.Binding
	Back    key.Binding
	Tab     key.Binding
	Enter   key.Binding
	Quit    key.Binding
}

func newKeyMap() *keyMap {
	return &keyMap{
		Sort: key.NewBinding(
			key.WithKeys("s"),
			key.WithHelp("s", "sort"),
		),
		Filter: key.NewBinding(
			key.WithKeys(" "),
			key.WithHelp("space", "dirty only"),
		),
		AddPath: key.NewBinding(
			key.WithKeys("c"),
			key.WithHelp("c", "add path"),
		),
		Back: key.NewBinding(
			key.WithKeys("esc", "h"),
			key.WithHelp("esc", "back"),
		),
		Tab: key.NewBinding(
			key.WithKeys("tab"),
			key.WithHelp("tab", "switch tab"),
		),
		Enter: key.NewBinding(
			key.WithKeys("enter"),
			key.WithHelp("enter", "select"),
		),
		Quit: key.NewBinding(
			key.WithKeys("q", "ctrl+c"),
			key.WithHelp("q", "quit"),
		),
	}
}

// --- Model ---

type Model struct {
	// State
	state       state
	activeTab   TabType
	sortType    SortType
	dirtyFilter bool
	width       int
	height      int
	ready       bool

	// Components
	list      list.Model
	textInput textinput.Model
	keys      *keyMap

	// Data
	config                 *config.Config
	projects               []string
	projectData            map[string]*ProjectItem
	activeTmuxSessionNames map[string]bool

	// Selection Context
	selectedRepo     string
	selectedRepoName string

	// Output
	AttachSession *AttachAction
}

func NewModel() Model {
	cfg, _ := config.LoadConfig()

	// Initialize list
	delegate := NewDelegate()
	l := list.New([]list.Item{}, delegate, 0, 0)
	l.SetShowTitle(false)
	l.SetShowHelp(true)
	l.SetShowStatusBar(false)
	l.SetFilteringEnabled(true)
	l.DisableQuitKeybindings()

	// Custom Help
	keys := newKeyMap()
	l.AdditionalShortHelpKeys = func() []key.Binding {
		return []key.Binding{keys.Tab, keys.Sort, keys.Filter}
	}
	l.AdditionalFullHelpKeys = func() []key.Binding {
		return []key.Binding{keys.Tab, keys.Sort, keys.Filter, keys.AddPath}
	}

	// Initialize TextInput
	ti := textinput.New()
	ti.Placeholder = "~/projects/work"
	ti.Focus()

	// Initial Data Load
	repos := discovery.FindGitRepos(cfg.SearchPaths, cfg.Depth)
	sessions, _ := tmux.ListSessions()
	sessionNames := make(map[string]bool)
	for _, s := range sessions {
		sessionNames[s.Name] = true
	}

	// Prepare Project Items
	projectData := make(map[string]*ProjectItem)
	for _, repo := range repos {
		repoName := naming.GetRepoName(repo)
		// Lazy load worktrees, but check active status
		// Note: To know if a project is active, we strictly need to know its worktrees/slugs.
		// However, for speed, we might defer this or check common patterns.
		// For now, we'll mark as inactive and let the async git load update it?
		// BETTER: Do a quick check or just wait for async.
		// Let's create the item and let Init() trigger git status and worktree checks.

		projectData[repo] = &ProjectItem{
			Name:       repoName,
			Path:       repo,
			RecentTime: recent.GetCombinedRecentTime(repo),
			GitLoading: true,
		}
	}

	m := Model{
		state:                  stateProjectList,
		activeTab:              TabAllProjects,
		sortType:               SortByRecent,
		list:                   l,
		keys:                   keys,
		textInput:              ti,
		config:                 cfg,
		projects:               repos,
		projectData:            projectData,
		activeTmuxSessionNames: sessionNames,
	}

	m.refreshList()
	return m
}

func (m Model) Init() tea.Cmd {
	// Async batch load of git statuses and active check
	var cmds []tea.Cmd
	cmds = append(cmds, tea.EnterAltScreen)

	for _, repo := range m.projects {
		path := repo
		// Status
		cmds = append(cmds, func() tea.Msg {
			status, err := git.GetStatus(path)
			return gitStatusMsg{Path: path, Status: status, Error: err}
		})
		// Worktrees (to check active status accurately)
		cmds = append(cmds, func() tea.Msg {
			wts, err := git.ListWorktrees(path)
			return projectWorktreesMsg{Path: path, Worktrees: wts, Error: err}
		})
	}
	return tea.Batch(cmds...)
}

// --- Messages ---

type gitStatusMsg struct {
	Path   string
	Status *git.GitStatus
	Error  error
}

type projectWorktreesMsg struct {
	Path      string
	Worktrees []git.Worktree
	Error     error
}

type worktreeListMsg struct {
	Worktrees []git.Worktree
}

// --- Update ---

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	var cmds []tea.Cmd

	// Handle global keys
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.state != stateAddPath && !m.list.SettingFilter() {
			switch {
			case key.Matches(msg, m.keys.Quit):
				return m, tea.Quit
			}
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true
		// Recalculate layout
		m.resizeList()
	}

	// State-specific handling
	switch m.state {
	case stateAddPath:
		switch msg := msg.(type) {
		case tea.KeyMsg:
			switch msg.Type {
			case tea.KeyEnter:
				path := m.textInput.Value()
				if path != "" {
					m.config.SearchPaths = append(m.config.SearchPaths, path)
					config.SaveConfig(m.config)
					// Reload
					m.projects = discovery.FindGitRepos(m.config.SearchPaths, m.config.Depth)
					m.refreshList() // Simple refresh, won't load new git data immediately without Init cmds
				}
				m.state = stateProjectList
				m.textInput.Reset()
			case tea.KeyEsc:
				m.state = stateProjectList
				m.textInput.Reset()
			}
		}
		m.textInput, cmd = m.textInput.Update(msg)
		cmds = append(cmds, cmd)

	case stateProjectList:
		switch msg := msg.(type) {
		case tea.KeyMsg:
			if !m.list.SettingFilter() {
				switch {
				case key.Matches(msg, m.keys.Tab):
					if m.activeTab == TabAllProjects {
						m.activeTab = TabActiveSessions
					} else {
						m.activeTab = TabAllProjects
					}
					m.refreshList()
				case key.Matches(msg, m.keys.Sort):
					m.sortType = (m.sortType + 1) % 3
					m.refreshList()
				case key.Matches(msg, m.keys.Filter):
					m.dirtyFilter = !m.dirtyFilter
					m.refreshList()
				case key.Matches(msg, m.keys.AddPath):
					m.state = stateAddPath
				case key.Matches(msg, m.keys.Enter):
					if i, ok := m.list.SelectedItem().(ProjectItem); ok {
						m.selectedRepo = i.Path
						m.selectedRepoName = i.Name
						m.state = stateWorktreeList
						// Trigger load of worktrees for the detail view
						cmds = append(cmds, m.loadWorktreesForView(i.Path))
					}
				}
			}
		// Data Updates
		case gitStatusMsg:
			if p, ok := m.projectData[msg.Path]; ok {
				p.GitLoading = false
				p.GitStatus = msg.Status
				p.GitError = msg.Error != nil
				m.refreshList()
			}
		case projectWorktreesMsg:
			if p, ok := m.projectData[msg.Path]; ok {
				p.WorktreeCount = len(msg.Worktrees)
				// Check active
				isActive := false
				for _, wt := range msg.Worktrees {
					slug := naming.GetSlugFromWorktree(wt.Path, p.Name, wt.IsMain)
					sessionName := naming.GetSessionName(p.Name, slug)
					if m.activeTmuxSessionNames[sessionName] {
						isActive = true
						break
					}
				}
				p.IsActive = isActive
				m.refreshList()
			}
		}

		m.list, cmd = m.list.Update(msg)
		cmds = append(cmds, cmd)

	case stateWorktreeList:
		switch msg := msg.(type) {
		case tea.KeyMsg:
			if !m.list.SettingFilter() {
				switch {
				case key.Matches(msg, m.keys.Back):
					m.state = stateProjectList
					m.refreshList()
				case key.Matches(msg, m.keys.Enter):
					if i, ok := m.list.SelectedItem().(WorktreeItem); ok {
						slug := naming.GetSlugFromWorktree(i.Path, m.selectedRepoName, i.Worktree.IsMain)
						sessionName := naming.GetSessionName(m.selectedRepoName, slug)
						m.AttachSession = &AttachAction{
							SessionName: sessionName,
							Cwd:         i.Path,
						}
						return m, tea.Quit
					}
				}
			}
		case worktreeListMsg:
			// Populate list with worktrees
			var items []list.Item
			for _, wt := range msg.Worktrees {
				slug := naming.GetSlugFromWorktree(wt.Path, m.selectedRepoName, wt.IsMain)
				isRoot := naming.IsRoot(slug, m.selectedRepoName, wt.Path, wt.IsMain)
				sessionName := naming.GetSessionName(m.selectedRepoName, slug)
				isActive := m.activeTmuxSessionNames[sessionName]

				// Note: We might want to fetch git status for EACH worktree here individually?
				// For now, let's just reuse the project status or fetch fresh?
				// The requirement says "Filter Dirty only" applies to projects.
				// For worktrees, we can just show them.
				// Let's trigger a status check for the worktree path.

				wItem := WorktreeItem{
					Slug:       slug,
					Branch:     wt.Branch,
					Path:       wt.Path,
					IsActive:   isActive,
					IsRoot:     isRoot,
					RecentTime: recent.GetCombinedRecentTime(wt.Path),
					GitLoading: true,
					Worktree:   &wt, // Safe pointer
				}
				items = append(items, wItem)
				cmds = append(cmds, func() tea.Msg {
					s, e := git.GetStatus(wt.Path)
					return worktreeGitStatusMsg{Path: wt.Path, Status: s, Error: e}
				})
			}
			m.list.SetItems(items)
			m.list.ResetSelected()
			m.resizeList() // Update title etc

		case worktreeGitStatusMsg:
			// Update item in list
			items := m.list.Items()
			for i, item := range items {
				if wt, ok := item.(WorktreeItem); ok && wt.Path == msg.Path {
					wt.GitLoading = false
					wt.GitStatus = msg.Status
					wt.GitError = msg.Error != nil
					items[i] = wt
					m.list.SetItems(items) // Trigger redraw
					break
				}
			}
		}

		m.list, cmd = m.list.Update(msg)
		cmds = append(cmds, cmd)
	}

	return m, tea.Batch(cmds...)
}

// --- Messages for Detail View ---

type worktreeGitStatusMsg struct {
	Path   string
	Status *git.GitStatus
	Error  error
}

func (m Model) loadWorktreesForView(path string) tea.Cmd {
	return func() tea.Msg {
		wts, err := git.ListWorktrees(path)
		if err != nil {
			return nil // Or error msg
		}
		return worktreeListMsg{Worktrees: wts}
	}
}

// --- View ---

func (m Model) View() string {
	if !m.ready {
		return "Initializing..."
	}

	if m.state == stateAddPath {
		return StyleApp.Render(
			lipgloss.JoinVertical(lipgloss.Left,
				StyleHeader.Render("Add Search Path"),
				fmt.Sprintf("\n%s\n\n%s",
					m.textInput.View(),
					StyleTabInactive.Render("Esc: Cancel • Enter: Save"),
				),
			),
		)
	}

	// Calculate Header
	var header string

	if m.state == stateProjectList {
		// 1. Tabs
		var tabs []string
		for i, t := range tabTitles {
			if TabType(i) == m.activeTab {
				tabs = append(tabs, StyleTabActive.Render(t))
			} else {
				tabs = append(tabs, StyleTabInactive.Render(t))
			}
		}
		tabRow := lipgloss.JoinHorizontal(lipgloss.Top, tabs...)

		// 2. Filter/Sort Bar
		filterText := "[ ] Dirty only"
		if m.dirtyFilter {
			filterText = "[x] Dirty only"
			filterText = StyleFilterActive.Render(filterText)
		} else {
			filterText = StyleFilterBar.Render(filterText)
		}

		sortText := fmt.Sprintf("Sort: %s", sortNames[m.sortType])
		sortText = StyleFilterBar.Render(sortText)

		infoRow := lipgloss.JoinHorizontal(lipgloss.Left, filterText, "  ", sortText)

		headerContent := lipgloss.JoinVertical(lipgloss.Left, tabRow, "\n", infoRow)
		header = StyleHeader.Width(m.width - 4).Render(headerContent)

	} else if m.state == stateWorktreeList {
		// Detail Header
		title := StyleTabActive.Render(m.selectedRepoName)
		path := StyleItemPath.Render(m.selectedRepo)
		headerContent := lipgloss.JoinVertical(lipgloss.Left, title, path)
		header = StyleHeader.Width(m.width - 4).Render(headerContent)
	}

	// Layout
	return StyleApp.Render(
		lipgloss.JoinVertical(lipgloss.Left,
			header,
			m.list.View(),
		),
	)
}

// --- Helpers ---

func (m *Model) refreshList() {
	if m.state != stateProjectList {
		return
	}

	var filtered []*ProjectItem

	for _, name := range m.projects {
		p := m.projectData[name]
		if p == nil {
			continue
		}

		// Tab Filter
		if m.activeTab == TabActiveSessions && !p.IsActive {
			continue
		}

		// Dirty Filter
		if m.dirtyFilter {
			// If loading, keep it. If dirty, keep it.
			isDirty := p.GitStatus != nil && p.GitStatus.IsDirty()
			if !p.GitLoading && !isDirty {
				continue
			}
		}

		filtered = append(filtered, p)
	}

	// Sort
	switch m.sortType {
	case SortByName:
		sort.Slice(filtered, func(i, j int) bool {
			return filtered[i].Name < filtered[j].Name
		})
	case SortByRecent:
		sort.Slice(filtered, func(i, j int) bool {
			return filtered[i].RecentTime.After(filtered[j].RecentTime)
		})
	case SortByActive:
		sort.Slice(filtered, func(i, j int) bool {
			if filtered[i].IsActive != filtered[j].IsActive {
				return filtered[i].IsActive
			}
			return filtered[i].Name < filtered[j].Name
		})
	}

	// Convert to list.Item
	items := make([]list.Item, len(filtered))
	for i, p := range filtered {
		items[i] = *p
	}
	m.list.SetItems(items)
}

func (m *Model) resizeList() {
	// Calculate header height dynamically by rendering it
	// This is expensive but safe. Or we can estimate.
	// Header is usually: Border(1) + Tabs(1) + Newline(1) + Info(1) + Border(1) = 5 lines?
	// StyleApp padding (1 top + 1 bottom)
	// Let's render a dummy header to measure.

	headerHeight := 6 // Approximation based on visual elements
	// Header:
	// ┌────────┐
	// │ Tabs   │
	// │        │
	// │ Filter │
	// └────────┘
	// + Margins

	// Actually, let's try to be more precise if possible, or just set a safe area.
	// With lipgloss, we can Measure().

	// App Padding: 2 (Top/Bottom 1)
	// Header: ~5-6

	availHeight := m.height - headerHeight - 2
	if availHeight < 0 {
		availHeight = 0
	}

	m.list.SetSize(m.width-4, availHeight)
}
