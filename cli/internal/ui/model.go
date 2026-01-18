package ui

import (
	"fmt"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kargnas/tmux-worktree-tui/pkg/config"
	"github.com/kargnas/tmux-worktree-tui/pkg/discovery"
	"github.com/kargnas/tmux-worktree-tui/pkg/git"
	"github.com/kargnas/tmux-worktree-tui/pkg/naming"
)

type state int

const (
	stateProjectList state = iota
	stateWorktreeList
	stateConfig
	stateAddPath
)

type item struct {
	title, desc string
	path        string        // for projects
	worktree    *git.Worktree // for worktrees
}

func (i item) Title() string       { return i.title }
func (i item) Description() string { return i.desc }
func (i item) FilterValue() string { return i.title }

type AttachAction struct {
	SessionName string
	Cwd         string
}

type Model struct {
	state         state
	list          list.Model
	config        *config.Config
	projects      []string
	selectedRepo  string
	repoName      string
	textInput     textinput.Model
	width, height int

	// Pending attach action to perform after quit
	AttachSession *AttachAction
}

type keyMap struct {
	AddPath key.Binding
}

func newKeyMap() *keyMap {
	return &keyMap{
		AddPath: key.NewBinding(
			key.WithKeys("c"),
			key.WithHelp("c", "add path"),
		),
	}
}

func NewModel() Model {
	cfg, _ := config.LoadConfig()

	repos := discovery.FindGitRepos(cfg.SearchPaths, cfg.Depth)

	items := make([]list.Item, len(repos))
	for i, repo := range repos {
		items[i] = item{title: naming.GetRepoName(repo), desc: repo, path: repo}
	}

	delegate := list.NewDefaultDelegate()

	delegate.Styles.NormalTitle = NormalTitle
	delegate.Styles.NormalDesc = NormalDesc
	delegate.Styles.SelectedTitle = SelectedTitle
	delegate.Styles.SelectedDesc = SelectedDesc

	l := list.New(items, delegate, 0, 0)
	l.Title = "Select Project"
	l.SetShowHelp(true)
	l.SetFilteringEnabled(true)

	l.Styles.HelpStyle = HelpStyle
	l.Styles.Title = ListTitleStyle

	keys := newKeyMap()
	l.AdditionalShortHelpKeys = func() []key.Binding {
		return []key.Binding{keys.AddPath}
	}
	l.AdditionalFullHelpKeys = func() []key.Binding {
		return []key.Binding{keys.AddPath}
	}

	ti := textinput.New()
	ti.Placeholder = "/path/to/search"
	ti.Focus()

	return Model{
		state:     stateProjectList,
		list:      l,
		config:    cfg,
		projects:  repos,
		textInput: ti,
	}
}

func (m Model) Init() tea.Cmd {
	return nil
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.list.SetSize(msg.Width, msg.Height)

	case tea.KeyMsg:
		if m.state == stateAddPath {
			switch msg.Type {
			case tea.KeyEnter:
				path := m.textInput.Value()
				if path != "" {
					m.config.SearchPaths = append(m.config.SearchPaths, path)
					if err := config.SaveConfig(m.config); err != nil {
						return m, tea.Quit
					}
					// Refresh
					m.projects = discovery.FindGitRepos(m.config.SearchPaths, m.config.Depth)
					items := make([]list.Item, len(m.projects))
					for i, repo := range m.projects {
						items[i] = item{title: naming.GetRepoName(repo), desc: repo, path: repo}
					}
					m.list.SetItems(items)
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
		case "c":
			if m.state == stateProjectList {
				m.state = stateAddPath
				return m, nil
			}
		case "esc":
			if m.state == stateWorktreeList {
				m.state = stateProjectList
				// Refresh project list
				items := make([]list.Item, len(m.projects))
				for i, repo := range m.projects {
					items[i] = item{title: naming.GetRepoName(repo), desc: repo, path: repo}
				}
				m.list.SetItems(items)
				m.list.Title = "Select Project"
				return m, nil
			}
		case "enter":
			if m.state == stateProjectList {
				i, ok := m.list.SelectedItem().(item)
				if ok {
					m.selectedRepo = i.path
					m.repoName = naming.GetRepoName(i.path)
					m.state = stateWorktreeList
					return m, m.loadWorktrees(i.path)
				}
			} else if m.state == stateWorktreeList {
				i, ok := m.list.SelectedItem().(item)
				if ok {
					// Prepare attach action and quit
					wt := i.worktree
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
		items := make([]list.Item, len(msg))
		for i, wt := range msg {
			slug := naming.GetSlugFromWorktree(wt.Path, m.repoName, wt.IsMain)
			isRoot := naming.IsRoot(slug, m.repoName, wt.Path, wt.IsMain)

			title := slug
			if isRoot {
				title = "(root)"
			}

			desc := fmt.Sprintf("%s [%s]", wt.Path, wt.Branch)
			items[i] = item{title: title, desc: desc, worktree: &wt}
		}
		m.list.SetItems(items)
		m.list.Title = fmt.Sprintf("Worktrees: %s", m.repoName)
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

	if m.state == stateProjectList && len(m.list.Items()) == 0 {
		return EmptyStyle.Render("⚠️  No projects found!") + "\n\n" +
			HintStyle.Render("Press 'c' to add a search path (e.g., ~/projects)\n"+
				"Press 'q' to quit\n"+
				"Press '?' for help")
	}

	return m.list.View()
}

type worktreesMsg []git.Worktree

func (m Model) loadWorktrees(path string) tea.Cmd {
	return func() tea.Msg {
		wts, err := git.ListWorktrees(path)
		if err != nil {
			return nil // Handle error properly in real app
		}
		return worktreesMsg(wts)
	}
}
