package ui

import (
	"fmt"
	"io"
	"time"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/kargnas/tmux-worktree-tui/pkg/git"
)

type SortType int

const (
	SortByName SortType = iota
	SortByRecent
	SortByActive
)

var sortNames = []string{"Name", "Recent", "Active"}

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

func (p ProjectItem) Title() string       { return p.Name }
func (p ProjectItem) Description() string { return p.Path }
func (p ProjectItem) FilterValue() string { return p.Name }

type ProjectDelegate struct {
	ShowStatusColumn bool
}

func NewProjectDelegate() ProjectDelegate {
	return ProjectDelegate{ShowStatusColumn: true}
}

func (d ProjectDelegate) Height() int                             { return 1 }
func (d ProjectDelegate) Spacing() int                            { return 0 }
func (d ProjectDelegate) Update(_ tea.Msg, _ *list.Model) tea.Cmd { return nil }

func (d ProjectDelegate) Render(w io.Writer, m list.Model, index int, listItem list.Item) {
	p, ok := listItem.(ProjectItem)
	if !ok {
		return
	}

	isSelected := index == m.Index()
	str := d.renderItem(p, isSelected, m.Width())
	fmt.Fprint(w, str)
}

func (d ProjectDelegate) renderItem(p ProjectItem, isSelected bool, width int) string {
	indicator := "○"
	if p.IsActive {
		indicator = "●"
	}

	var indicatorStyled string
	if p.IsActive {
		indicatorStyled = ActiveIndicatorStyle.Render(indicator)
	} else {
		indicatorStyled = InactiveIndicatorStyle.Render(indicator)
	}

	name := p.Name
	if len(name) > 20 {
		name = name[:17] + "..."
	}

	var nameStyled string
	if isSelected {
		nameStyled = SelectedTitle.Render(name)
	} else {
		nameStyled = NormalTitle.Render(name)
	}

	wtCount := fmt.Sprintf("[%d]", p.WorktreeCount)
	wtCountStyled := DimStyle.Render(wtCount)

	var gitStatusStr string
	if p.GitLoading {
		gitStatusStr = LoadingStyle.Render("...")
	} else if p.GitError {
		gitStatusStr = ErrorStyle.Render("--")
	} else if p.GitStatus != nil && p.GitStatus.IsDirty() {
		total := p.GitStatus.Modified + p.GitStatus.Added + p.GitStatus.Untracked
		gitStatusStr = DirtyStyle.Render(fmt.Sprintf("M:%d", total))
	} else {
		gitStatusStr = "     "
	}

	var timeStr string
	if p.RecentTime.IsZero() {
		timeStr = TimeStyle.Render("N/A")
	} else {
		timeStr = TimeStyle.Render(formatRelativeTimeShort(p.RecentTime))
	}

	return fmt.Sprintf("%s %-22s %s %s %s",
		indicatorStyled,
		nameStyled,
		wtCountStyled,
		gitStatusStr,
		timeStr,
	)
}

func formatRelativeTimeShort(t time.Time) string {
	if t.IsZero() {
		return "N/A"
	}

	duration := time.Since(t)

	if duration < time.Minute {
		return "now"
	}
	if duration < time.Hour {
		return fmt.Sprintf("%dm", int(duration.Minutes()))
	}
	if duration < 24*time.Hour {
		return fmt.Sprintf("%dh", int(duration.Hours()))
	}
	if duration < 7*24*time.Hour {
		return fmt.Sprintf("%dd", int(duration.Hours()/24))
	}
	if duration < 30*24*time.Hour {
		return fmt.Sprintf("%dw", int(duration.Hours()/24/7))
	}
	return fmt.Sprintf("%dmo", int(duration.Hours()/24/30))
}
