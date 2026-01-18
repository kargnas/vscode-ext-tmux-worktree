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
	return 2 // Tight 2-line layout
}

func (d ItemDelegate) Spacing() int {
	return 0 // No extra spacing between items
}

func (d ItemDelegate) Update(msg tea.Msg, m *list.Model) tea.Cmd {
	return nil
}

func (d ItemDelegate) Render(w io.Writer, m list.Model, index int, listItem list.Item) {
	i, ok := listItem.(Item)
	if !ok {
		return
	}

	// 1. Determine Base Style (Normal vs Selected)
	var baseStyle lipgloss.Style
	if index == m.Index() {
		baseStyle = selectedItemStyle
	} else {
		baseStyle = itemStyle
	}

	// 2. Prepare Content
	// Icon
	var icon string
	if i.Type == ItemTypeSession {
		icon = "⚡"
	} else if i.HasSession {
		icon = "⚡"
	} else {
		icon = "📁"
	}

	// Line 1: Title + Info + Status
	// Title
	title := repoNameStyle.Render(i.TitleStr)

	// Info (Branch or Windows)
	var info string
	if i.Type == ItemTypeRepo {
		// Extract branch from DescStr if possible, or just use it
		// DescStr in model.go is "Branch • Status"
		// We'll parse it or just assume the first part is branch.
		// Actually, let's use the DescStr but clean it up.
		parts := strings.Split(i.DescStr, "•")
		if len(parts) > 0 {
			info = strings.TrimSpace(parts[0]) // Branch name
		}
	} else {
		info = fmt.Sprintf("%d wins", i.Windows)
		if i.IsAttached {
			info += " • Attached"
		}
	}
	infoRendered := statusStyle.Render(info)

	// Git Status Badge
	var statusBadge string
	if i.IsDirty {
		statusBadge = statusDirtyStyle.Render("● Modified")
	}

	// Construct Line 1
	// [Icon] [Title]  [Info]        [Status]
	// To do right alignment properly in a list item is tricky without fixed width.
	// We'll just stack them left-aligned for now, but clean.
	line1 := fmt.Sprintf("%s %s  %s%s", icon, title, infoRendered, statusBadge)

	// Line 2: Path (Dimmed)
	// Truncate path if too long? For now just render.
	path := pathStyle.Render(i.Path)

	// 3. Render Final Block
	// We use JoinVertical to stack lines
	content := lipgloss.JoinVertical(lipgloss.Left,
		line1,
		path,
	)

	// Apply selection box style
	fmt.Fprint(w, baseStyle.Render(content))
}
