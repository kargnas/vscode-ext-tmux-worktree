package ui

import (
	"fmt"
	"sort"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kargnas/tmux-worktree-tui/pkg/config"
	"github.com/kargnas/tmux-worktree-tui/pkg/discovery"
	"github.com/kargnas/tmux-worktree-tui/pkg/git"
	"github.com/kargnas/tmux-worktree-tui/pkg/naming"
	"github.com/kargnas/tmux-worktree-tui/pkg/tmux"
)

// ItemType distinguishes between git repos and tmux sessions
type ItemType int

const (
	ItemTypeRepo ItemType = iota
	ItemTypeSession
)

// Item represents a list item (Project or Session)
type Item struct {
	TitleStr    string
	DescStr     string
	Path        string // Filesystem path
	SessionName string // Tmux session name
	Windows     int
	IsAttached  bool
	IsDirty     bool
	Type        ItemType
}

func (i Item) Title() string       { return i.TitleStr }
func (i Item) Description() string { return i.DescStr }
func (i Item) FilterValue() string { return i.TitleStr + " " + i.DescStr }

// AttachAction is the result returned to main.go
type AttachAction struct {
	SessionName string
	Cwd         string
}

type Tab int

const (
	TabProjects Tab = iota
	TabSessions
)

type Model struct {
	list        list.Model
	tabs        []string
	activeTab   Tab
	width       int
	height      int
	loading     bool
	spinner     spinner.Model
	filterDirty bool

	// Data storage
	allRepos    []Item
	allSessions []Item

	// Result
	AttachSession *AttachAction

	// Error handling
	err error
}

func NewModel() Model {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = spinnerStyle

	// Initialize list with default delegate
	delegate := NewItemDelegate()
	l := list.New([]list.Item{}, delegate, 0, 0)
	l.Title = "Projects"
	l.SetShowHelp(false)
	l.SetShowStatusBar(false) // We'll render our own custom status bar
	l.SetShowTitle(false)     // We'll render our own header
	l.DisableQuitKeybindings()

	return Model{
		list:        l,
		tabs:        []string{"Projects", "Sessions"},
		activeTab:   TabProjects,
		spinner:     s,
		loading:     true,
		allRepos:    []Item{},
		allSessions: []Item{},
	}
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(
		m.spinner.Tick,
		loadDataCmd(),
	)
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

		// Update list size
		// Calculate header height (approximate or measured)
		// Header = Tabs (3) + Gap (1) = 4 lines?
		// We'll measure precisely in View, but here we need to set list height.
		// Let's assume a fixed header height for stability, or calculate it.
		// Safe bet: Height - 6 (Header + Footer)
		headerHeight := 3 // Tabs + borders
		footerHeight := 2 // Status bar

		listHeight := m.height - headerHeight - footerHeight
		if listHeight < 0 {
			listHeight = 0
		}

		m.list.SetSize(msg.Width, listHeight)

	case tea.KeyMsg:
		if m.list.FilterState() == list.Filtering {
			break // Let list handle keys when filtering
		}

		switch {
		case key.Matches(msg, key.NewBinding(key.WithKeys("q", "ctrl+c"))):
			return m, tea.Quit

		case key.Matches(msg, key.NewBinding(key.WithKeys("tab"))):
			m.switchTab()
			cmds = append(cmds, m.refreshList())

		case key.Matches(msg, key.NewBinding(key.WithKeys("f"))):
			m.filterDirty = !m.filterDirty
			cmds = append(cmds, m.refreshList())

		case key.Matches(msg, key.NewBinding(key.WithKeys("enter"))):
			if i, ok := m.list.SelectedItem().(Item); ok {
				return m.selectItem(i)
			}

		case key.Matches(msg, key.NewBinding(key.WithKeys("r"))):
			m.loading = true
			cmds = append(cmds, loadDataCmd())
		}

	case dataLoadedMsg:
		m.loading = false
		m.allRepos = msg.repos
		m.allSessions = msg.sessions
		cmds = append(cmds, m.refreshList())

	case spinner.TickMsg:
		m.spinner, cmd = m.spinner.Update(msg)
		cmds = append(cmds, cmd)
	}

	m.list, cmd = m.list.Update(msg)
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

func (m *Model) switchTab() {
	if m.activeTab == TabProjects {
		m.activeTab = TabSessions
	} else {
		m.activeTab = TabProjects
	}
}

func (m *Model) refreshList() tea.Cmd {
	var items []list.Item

	source := m.allRepos
	if m.activeTab == TabSessions {
		source = m.allSessions
	}

	for _, item := range source {
		if m.filterDirty && !item.IsDirty {
			continue
		}
		items = append(items, item)
	}

	return m.list.SetItems(items)
}

func (m Model) selectItem(i Item) (tea.Model, tea.Cmd) {
	// Item already has the correct SessionName calculated during loading
	m.AttachSession = &AttachAction{
		SessionName: i.SessionName,
		Cwd:         i.Path,
	}
	return m, tea.Quit
}

func (m Model) View() string {
	if m.width == 0 {
		return "Loading..."
	}

	header := m.viewHeader()
	statusBar := m.viewStatusBar()

	return lipgloss.JoinVertical(lipgloss.Left,
		header,
		m.list.View(),
		statusBar,
	)
}

func (m Model) viewHeader() string {
	// Tabs
	var tabs []string
	for i, t := range m.tabs {
		if m.activeTab == Tab(i) {
			tabs = append(tabs, activeTabStyle.Render(t))
		} else {
			tabs = append(tabs, tabStyle.Render(t))
		}
	}

	row := lipgloss.JoinHorizontal(lipgloss.Top, tabs...)

	// Filter indicator
	if m.filterDirty {
		row = lipgloss.JoinHorizontal(lipgloss.Center, row, filterStyle.Render("F:Dirty Only"))
	}

	// Spinner
	if m.loading {
		row = lipgloss.JoinHorizontal(lipgloss.Center, row, "  ", m.spinner.View())
	}

	return lipgloss.NewStyle().Padding(0, 1).Render(row)
}

func (m Model) viewStatusBar() string {
	// Simple status bar
	// Keys: Tab: Switch, F: Filter, Enter: Select, q: Quit
	help := "Tab: Switch • f: Filter • Enter: Select • r: Reload • q: Quit"
	return statusBarStyle.Render(help)
}

// Data Loading

type dataLoadedMsg struct {
	repos    []Item
	sessions []Item
}

func loadDataCmd() tea.Cmd {
	return func() tea.Msg {
		cfg, err := config.LoadConfig()
		if err != nil {
			cfg = &config.Config{Depth: 2}
		}

		repos := discovery.FindGitRepos(cfg.SearchPaths, cfg.Depth)
		tmuxSessions, _ := tmux.ListSessions()

		sessionMap := make(map[string]bool)
		for _, s := range tmuxSessions {
			sessionMap[s.Name] = true
		}

		var repoItems []Item
		var sessionItems []Item

		for _, repoPath := range repos {
			repoName := naming.GetRepoName(repoPath)
			wts, _ := git.ListWorktrees(repoPath)

			for _, wt := range wts {
				slug := naming.GetSlugFromWorktree(wt.Path, repoName, wt.IsMain)
				sessionName := naming.GetSessionName(repoName, slug)

				status, _ := git.GetStatus(wt.Path)
				isDirty := status != nil && status.IsDirty()

				statusStr := ""
				if status != nil {
					statusStr = fmt.Sprintf("M:%d A:%d U:%d", status.Modified, status.Added, status.Untracked)
				}

				title := slug
				if naming.IsRoot(slug, repoName, wt.Path, wt.IsMain) {
					title = "(root) " + repoName
				}

				item := Item{
					TitleStr:    title,
					DescStr:     fmt.Sprintf("%s • %s", wt.Branch, statusStr),
					Path:        wt.Path,
					SessionName: sessionName,
					IsAttached:  sessionMap[sessionName],
					IsDirty:     isDirty,
					Type:        ItemTypeRepo,
				}
				repoItems = append(repoItems, item)

				if sessionMap[sessionName] {
					item.Type = ItemTypeSession
					sessionItems = append(sessionItems, item)
				}
			}
		}

		sort.Slice(repoItems, func(i, j int) bool {
			return repoItems[i].TitleStr < repoItems[j].TitleStr
		})

		return dataLoadedMsg{
			repos:    repoItems,
			sessions: sessionItems,
		}
	}
}
