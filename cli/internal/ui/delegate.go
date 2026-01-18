package ui

import (
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/kargnas/tmux-worktree-tui/pkg/git"
)

// --- Items ---

// ProjectItem represents a git repository in the list.
type ProjectItem struct {
	Name          string
	Path          string
	WorktreeCount int
	RecentTime    time.Time
	IsActive      bool
	GitStatus     *git.GitStatus
	GitLoading    bool
	GitError      bool
}

func (i ProjectItem) FilterValue() string { return i.Name + " " + i.Path }

// WorktreeItem represents a specific worktree (or the main repo) in the list.
type WorktreeItem struct {
	Slug       string // Display name (e.g. "main", "feature-x")
	Branch     string
	Path       string
	IsActive   bool
	IsRoot     bool
	RecentTime time.Time
	GitStatus  *git.GitStatus
	GitLoading bool
	GitError   bool
	Worktree   *git.Worktree // Underlying data
}

func (i WorktreeItem) FilterValue() string { return i.Slug + " " + i.Branch }

// --- Delegate ---

type Delegate struct {
	Styles DelegateStyles
}

type DelegateStyles struct {
	Selected lipgloss.Style
	Normal   lipgloss.Style
	Dim      lipgloss.Style
}

func NewDelegate() Delegate {
	return Delegate{
		Styles: DelegateStyles{
			Selected: lipgloss.NewStyle().
				Border(lipgloss.NormalBorder(), false, false, false, true).
				BorderForeground(ColorAccent).
				Foreground(ColorAccent).
				PaddingLeft(1),
			Normal: lipgloss.NewStyle().
				PaddingLeft(2),
			Dim: lipgloss.NewStyle().
				Foreground(ColorDim),
		},
	}
}

func (d Delegate) Height() int {
	return 2 // 2 lines per item for better info density
}

func (d Delegate) Spacing() int {
	return 0
}

func (d Delegate) Update(msg tea.Msg, m *list.Model) tea.Cmd {
	return nil
}

func (d Delegate) Render(w io.Writer, m list.Model, index int, item list.Item) {
	var (
		titleStr    string
		descStr     string
		statusBadge string
		activeBadge string
	)

	isSelected := index == m.Index()

	switch i := item.(type) {
	case ProjectItem:
		// Title: Name + Active Badge
		titleStr = i.Name
		if i.IsActive {
			activeBadge = " " + StyleBadgeActive.Render()
		}

		// Desc: Path • Worktrees • Status
		parts := []string{shortenPath(i.Path)}
		parts = append(parts, fmt.Sprintf("%d wts", i.WorktreeCount))

		if i.GitLoading {
			statusBadge = d.Styles.Dim.Render("…")
		} else if i.GitError {
			statusBadge = lipgloss.NewStyle().Foreground(ColorError).Render("!")
		} else if i.GitStatus != nil && i.GitStatus.IsDirty() {
			statusBadge = StyleBadgeDirty.Render()
			// Add detail: M:1 A:0 ...
			stats := []string{}
			if i.GitStatus.Modified > 0 {
				stats = append(stats, fmt.Sprintf("M:%d", i.GitStatus.Modified))
			}
			if i.GitStatus.Added > 0 {
				stats = append(stats, fmt.Sprintf("A:%d", i.GitStatus.Added))
			}
			if i.GitStatus.Untracked > 0 {
				stats = append(stats, fmt.Sprintf("?:%d", i.GitStatus.Untracked))
			}
			if len(stats) > 0 {
				parts = append(parts, strings.Join(stats, " "))
			}
		} else {
			statusBadge = StyleBadgeClean.Render()
		}

		descStr = strings.Join(parts, " • ")

	case WorktreeItem:
		// Title: Slug (Active)
		titleStr = i.Slug
		if i.IsRoot {
			titleStr += " (root)"
		}
		if i.IsActive {
			activeBadge = " " + StyleBadgeActive.Render()
		}

		// Desc: Branch • Status
		parts := []string{i.Branch}

		if i.GitLoading {
			statusBadge = d.Styles.Dim.Render("…")
		} else if i.GitError {
			statusBadge = lipgloss.NewStyle().Foreground(ColorError).Render("!")
		} else if i.GitStatus != nil && i.GitStatus.IsDirty() {
			statusBadge = StyleBadgeDirty.Render()
		} else {
			statusBadge = StyleBadgeClean.Render()
		}

		descStr = strings.Join(parts, " • ")
	}

	// Render
	var title, desc string

	if isSelected {
		title = d.Styles.Selected.Render(titleStr + activeBadge + " " + statusBadge)
		desc = d.Styles.Selected.Copy().Foreground(ColorDim).Render(descStr)
	} else {
		title = d.Styles.Normal.Render(titleStr + activeBadge + " " + statusBadge)
		desc = d.Styles.Normal.Copy().Foreground(ColorDim).Render(descStr)
	}

	fmt.Fprintf(w, "%s\n%s", title, desc)
}

func shortenPath(p string) string {
	// Simple shortener
	parts := strings.Split(p, "/")
	if len(parts) > 3 {
		return ".../" + strings.Join(parts[len(parts)-2:], "/")
	}
	return p
}
