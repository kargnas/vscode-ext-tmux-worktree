package ui

import (
	"fmt"
	"io"
	"strings"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type ItemDelegate struct{}

func NewItemDelegate() list.ItemDelegate {
	return ItemDelegate{}
}

func (d ItemDelegate) Height() int {
	return 3 // Title + Info + Spacing
}

func (d ItemDelegate) Spacing() int {
	return 0
}

func (d ItemDelegate) Update(msg tea.Msg, m *list.Model) tea.Cmd {
	return nil
}

func (d ItemDelegate) Render(w io.Writer, m list.Model, index int, listItem list.Item) {
	i, ok := listItem.(Item)
	if !ok {
		return
	}

	// Styles
	titleStyle := lipgloss.NewStyle().Foreground(textColor).Bold(true)
	descStyle := lipgloss.NewStyle().Foreground(subtleColor)

	if index == m.Index() {
		titleStyle = titleStyle.Foreground(primaryColor)
		descStyle = descStyle.Foreground(secondaryColor)
	}

	// Line 1: Repo Name / Session Name
	title := i.TitleStr
	if i.Type == ItemTypeRepo {
		title = fmt.Sprintf("📁 %s", title)
	} else {
		title = fmt.Sprintf("Tmux: %s", title)
	}

	// Line 2: Details
	// Branch/Session Name · Pane Count · Last Active Time
	// We don't have "Last Active Time" in Item yet, assuming simple layout for now.
	// For repo: Branch (if available) or Path
	// For session: Windows count

	var details []string
	if i.Type == ItemTypeRepo {
		details = append(details, i.Path)
	} else {
		details = append(details, fmt.Sprintf("%d windows", i.Windows))
		if i.IsAttached {
			details = append(details, "Attached")
		}
	}

	detailStr := strings.Join(details, " · ")

	// Line 3: Git Status (Conditional)
	var statusStr string
	if i.IsDirty {
		statusStr = "Dirty" // Placeholder, real status needed
		if index == m.Index() {
			statusStr = lipgloss.NewStyle().Foreground(errorColor).Render("M:? A:? D:? (Dirty)")
		} else {
			statusStr = lipgloss.NewStyle().Foreground(warningColor).Render("Modified")
		}
	}

	// Render
	var body string
	if statusStr != "" {
		body = fmt.Sprintf("%s\n%s\n%s", titleStyle.Render(title), descStyle.Render(detailStr), statusStr)
	} else {
		body = fmt.Sprintf("%s\n%s", titleStyle.Render(title), descStyle.Render(detailStr))
	}

	// Border/Padding for selection
	container := lipgloss.NewStyle().PaddingLeft(2)
	if index == m.Index() {
		container = container.
			Border(lipgloss.NormalBorder(), false, false, false, true).
			BorderForeground(primaryColor).
			PaddingLeft(1)
	}

	fmt.Fprint(w, container.Render(body))
}
