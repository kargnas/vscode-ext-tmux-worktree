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

type state int

const (
	stateProjectList state = iota
	stateWorktreeList
	stateConfig
	stateAddPath
)

// TabType represents the current tab in the project list view
type TabType int

const (
	TabAllProjects TabType = iota
	TabActiveSessions
)

var tabTitles = []string{"All Projects", "Active Sessions"}

type AttachAction struct {
	SessionName string
	Cwd         string
}

type Model struct {
	state         state
	activeTab     TabType
	sortType      SortType
	dirtyFilter   bool
	list          list.Model
	config        *config.Config
	projects      []string
	projectData   map[string]*ProjectItem
	selectedRepo  string
	repoName      string
	textInput     textinput.Model
	width, height int

	activeTmuxSessionNames map[string]bool

	AttachSession *AttachAction
}

type keyMap struct {
	AddPath key.Binding
	Sort    key.Binding
	Filter  key.Binding
}

func newKeyMap() *keyMap {
	return &keyMap{
		AddPath: key.NewBinding(
			key.WithKeys("c"),
			key.WithHelp("c", "add path"),
		),
		Sort: key.NewBinding(
			key.WithKeys("s"),
			key.WithHelp("s", "sort"),
		),
		Filter: key.NewBinding(
			key.WithKeys(" "),
			key.WithHelp("space", "filter dirty"),
		),
	}
}

func NewModel() Model {
	cfg, _ := config.LoadConfig()

	repos := discovery.FindGitRepos(cfg.SearchPaths, cfg.Depth)

	sessions, _ := tmux.ListSessions()
	sessionNames := make(map[string]bool)
	for _, s := range sessions {
		sessionNames[s.Name] = true
	}

	projectData := make(map[string]*ProjectItem)
	for _, repo := range repos {
		repoName := naming.GetRepoName(repo)
		wts, _ := git.ListWorktrees(repo)

		isActive := false
		for _, wt := range wts {
			slug := naming.GetSlugFromWorktree(wt.Path, repoName, wt.IsMain)
			sessionName := naming.GetSessionName(repoName, slug)
			if sessionNames[sessionName] {
				isActive = true
				break
			}
		}

		projectData[repo] = &ProjectItem{
			Name:          repoName,
			Path:          repo,
			WorktreeCount: len(wts),
			RecentTime:    recent.GetCombinedRecentTime(repo),
			IsActive:      isActive,
			GitLoading:    true,
		}
	}

	delegate := NewProjectDelegate()
	l := list.New([]list.Item{}, delegate, 0, 0)
	l.Title = ""
	l.SetShowHelp(true)
	l.SetFilteringEnabled(true)
	l.SetShowStatusBar(false)

	l.Styles.HelpStyle = HelpStyle
	l.Styles.Title = ListTitleStyle

	keys := newKeyMap()
	l.AdditionalShortHelpKeys = func() []key.Binding {
		return []key.Binding{keys.AddPath, keys.Sort, keys.Filter}
	}
	l.AdditionalFullHelpKeys = func() []key.Binding {
		return []key.Binding{keys.AddPath, keys.Sort, keys.Filter}
	}

	ti := textinput.New()
	ti.Placeholder = "/path/to/search"
	ti.Focus()

	m := Model{
		state:                  stateProjectList,
		activeTab:              TabAllProjects,
		sortType:               SortByRecent,
		dirtyFilter:            false,
		list:                   l,
		config:                 cfg,
		projects:               repos,
		projectData:            projectData,
		textInput:              ti,
		activeTmuxSessionNames: sessionNames,
	}

	m.refreshProjectList()

	return m
}

func (m Model) Init() tea.Cmd {
	var cmds []tea.Cmd
	for _, repo := range m.projects {
		path := repo
		cmds = append(cmds, func() tea.Msg {
			status, err := git.GetStatus(path)
			return gitStatusMsg{Path: path, Status: status, Error: err}
		})
	}
	return tea.Batch(cmds...)
}

type gitStatusMsg struct {
	Path   string
	Status *git.GitStatus
	Error  error
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		headerHeight := 4
		m.list.SetSize(msg.Width, msg.Height-headerHeight)

	case gitStatusMsg:
		if p, ok := m.projectData[msg.Path]; ok {
			p.GitLoading = false
			if msg.Error != nil {
				p.GitError = true
			} else {
				p.GitStatus = msg.Status
			}
			m.refreshProjectList()
		}

	case tea.KeyMsg:
		if m.list.FilterState() == list.Filtering {
			m.list, cmd = m.list.Update(msg)
			return m, cmd
		}

		if m.state == stateAddPath {
			switch msg.Type {
			case tea.KeyEnter:
				path := m.textInput.Value()
				if path != "" {
					m.config.SearchPaths = append(m.config.SearchPaths, path)
					if err := config.SaveConfig(m.config); err != nil {
						return m, tea.Quit
					}
					m.projects = discovery.FindGitRepos(m.config.SearchPaths, m.config.Depth)
					m.refreshProjectList()
				}
				m.textInput.Reset()
				m.state = stateProjectList
				return m, nil
			case tea.KeyEsc:
				m.state = stateProjectList
				return m, nil
			}
			m.textInput, cmd = m.textInput.Update(msg)
			return m, cmd
		}

		switch msg.String() {
		case "ctrl+c", "q":
			if m.state == stateProjectList || m.state == stateWorktreeList {
				return m, tea.Quit
			}
		case "tab":
			if m.state == stateProjectList {
				if m.activeTab == TabAllProjects {
					m.activeTab = TabActiveSessions
				} else {
					m.activeTab = TabAllProjects
				}
				m.refreshProjectList()
				return m, nil
			}
		case "s":
			if m.state == stateProjectList {
				m.sortType = (m.sortType + 1) % 3
				m.refreshProjectList()
				return m, nil
			}
		case " ":
			if m.state == stateProjectList {
				m.dirtyFilter = !m.dirtyFilter
				m.refreshProjectList()
				return m, nil
			}
		case "c":
			if m.state == stateProjectList {
				m.state = stateAddPath
				return m, nil
			}
		case "esc":
			if m.state == stateWorktreeList {
				m.state = stateProjectList
				m.refreshProjectList()
				return m, nil
			}
		case "enter":
			if m.state == stateProjectList {
				i, ok := m.list.SelectedItem().(ProjectItem)
				if ok {
					m.selectedRepo = i.Path
					m.repoName = i.Name
					m.state = stateWorktreeList
					return m, m.loadWorktrees(i.Path)
				}
			} else if m.state == stateWorktreeList {
				i, ok := m.list.SelectedItem().(WorktreeItem)
				if ok {
					wt := i.Worktree
					slug := naming.GetSlugFromWorktree(wt.Path, m.repoName, wt.IsMain)
					sessionName := naming.GetSessionName(m.repoName, slug)

					m.AttachSession = &AttachAction{
						SessionName: sessionName,
						Cwd:         wt.Path,
					}
					return m, tea.Quit
				}
			}
		}

	case worktreesMsg:
		items := make([]list.Item, len(msg.worktrees))
		for i, wt := range msg.worktrees {
			slug := naming.GetSlugFromWorktree(wt.Path, m.repoName, wt.IsMain)
			isRoot := naming.IsRoot(slug, m.repoName, wt.Path, wt.IsMain)

			displaySlug := slug
			if isRoot {
				displaySlug = "(root)"
			}

			sessionName := naming.GetSessionName(m.repoName, slug)
			isActive := m.activeTmuxSessionNames[sessionName]
			recentTime := recent.GetCombinedRecentTime(wt.Path)

			items[i] = WorktreeItem{
				Slug:       displaySlug,
				Branch:     wt.Branch,
				Path:       wt.Path,
				IsActive:   isActive,
				RecentTime: recentTime,
				GitLoading: true,
				Worktree:   &wt,
			}
		}
		m.list.SetItems(items)
		return m, m.loadWorktreeGitStatuses(msg.worktrees)

	case worktreeGitStatusMsg:
		for _, item := range m.list.Items() {
			if wt, ok := item.(WorktreeItem); ok && wt.Path == msg.Path {
				wt.GitLoading = false
				if msg.Error != nil {
					wt.GitError = true
				} else {
					wt.GitStatus = msg.Status
				}
				m.updateWorktreeItem(wt)
				break
			}
		}
	}

	m.list, cmd = m.list.Update(msg)
	return m, cmd
}

func (m Model) View() string {
	if m.state == stateAddPath {
		return fmt.Sprintf(
			"Enter search path:\n\n%s\n\n(esc to cancel, enter to save)",
			m.textInput.View(),
		)
	}

	if m.state == stateProjectList {
		tabHeader := m.renderTabs()
		filterLine := m.renderFilterLine()

		if len(m.list.Items()) == 0 {
			if m.activeTab == TabActiveSessions {
				return tabHeader + filterLine + EmptyStyle.Render("No active sessions") + "\n\n" +
					HintStyle.Render("Press Tab to switch to All Projects")
			}
			if m.dirtyFilter {
				return tabHeader + filterLine + EmptyStyle.Render("No dirty projects") + "\n\n" +
					HintStyle.Render("Press Space to disable filter")
			}
			return tabHeader + filterLine + EmptyStyle.Render("⚠️  No projects found!") + "\n\n" +
				HintStyle.Render("Press 'c' to add a search path (e.g., ~/projects)\n"+
					"Press 'q' to quit\n"+
					"Press '?' for help")
		}

		return tabHeader + filterLine + m.list.View()
	}

	if m.state == stateWorktreeList {
		title := fmt.Sprintf("Worktrees: %s", m.repoName)
		return ListTitleStyle.Render(title) + "\n" + m.list.View()
	}

	return m.list.View()
}

type worktreesMsg struct {
	worktrees []git.Worktree
}

type worktreeGitStatusMsg struct {
	Path   string
	Status *git.GitStatus
	Error  error
}

func (m Model) loadWorktrees(path string) tea.Cmd {
	return func() tea.Msg {
		wts, err := git.ListWorktrees(path)
		if err != nil {
			return nil
		}
		return worktreesMsg{worktrees: wts}
	}
}

func (m Model) loadWorktreeGitStatuses(worktrees []git.Worktree) tea.Cmd {
	var cmds []tea.Cmd
	for _, wt := range worktrees {
		path := wt.Path
		cmds = append(cmds, func() tea.Msg {
			status, err := git.GetStatus(path)
			return worktreeGitStatusMsg{Path: path, Status: status, Error: err}
		})
	}
	return tea.Batch(cmds...)
}

func (m *Model) updateWorktreeItem(updated WorktreeItem) {
	items := m.list.Items()
	for i, item := range items {
		if wt, ok := item.(WorktreeItem); ok && wt.Path == updated.Path {
			items[i] = updated
			break
		}
	}
	m.list.SetItems(items)
}

func (m *Model) refreshProjectList() {
	var filteredProjects []*ProjectItem

	for _, repo := range m.projects {
		p := m.projectData[repo]
		if p == nil {
			continue
		}

		if m.activeTab == TabActiveSessions && !p.IsActive {
			continue
		}

		if m.dirtyFilter {
			if p.GitLoading || p.GitError {
				filteredProjects = append(filteredProjects, p)
			} else if p.GitStatus != nil && p.GitStatus.IsDirty() {
				filteredProjects = append(filteredProjects, p)
			}
			continue
		}

		filteredProjects = append(filteredProjects, p)
	}

	switch m.sortType {
	case SortByName:
		sort.Slice(filteredProjects, func(i, j int) bool {
			return filteredProjects[i].Name < filteredProjects[j].Name
		})
	case SortByRecent:
		sort.Slice(filteredProjects, func(i, j int) bool {
			return filteredProjects[i].RecentTime.After(filteredProjects[j].RecentTime)
		})
	case SortByActive:
		sort.Slice(filteredProjects, func(i, j int) bool {
			if filteredProjects[i].IsActive != filteredProjects[j].IsActive {
				return filteredProjects[i].IsActive
			}
			return filteredProjects[i].Name < filteredProjects[j].Name
		})
	}

	items := make([]list.Item, len(filteredProjects))
	for i, p := range filteredProjects {
		items[i] = *p
	}
	m.list.SetItems(items)
}

func (m Model) renderTabs() string {
	var tabs []string
	for i, title := range tabTitles {
		if TabType(i) == m.activeTab {
			tabs = append(tabs, TabActiveStyle.Render(title))
		} else {
			tabs = append(tabs, TabInactiveStyle.Render(title))
		}
	}
	return lipgloss.JoinHorizontal(lipgloss.Top, tabs...) + "\n"
}

func (m Model) renderFilterLine() string {
	checkbox := "[ ]"
	if m.dirtyFilter {
		checkbox = "[x]"
	}

	var filterPart string
	if m.dirtyFilter {
		filterPart = FilterActiveStyle.Render(checkbox + " Dirty only")
	} else {
		filterPart = FilterInactiveStyle.Render(checkbox + " Dirty only")
	}

	sortPart := DimStyle.Render(fmt.Sprintf("Sort: %s", sortNames[m.sortType]))

	return filterPart + "  " + sortPart + "\n\n"
}
