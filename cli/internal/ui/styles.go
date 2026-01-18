package ui

import "github.com/charmbracelet/lipgloss"

var (
	// Colors
	primaryColor   = lipgloss.Color("#7D56F4") // Purple
	secondaryColor = lipgloss.Color("#FF79C6") // Pink
	accentColor    = lipgloss.Color("#8BE9FD") // Cyan
	subtleColor    = lipgloss.Color("#6272A4") // Gray/Blue
	warningColor   = lipgloss.Color("#FFB86C") // Orange
	errorColor     = lipgloss.Color("#FF5555") // Red
	successColor   = lipgloss.Color("#50FA7B") // Green
	textColor      = lipgloss.Color("#F8F8F2") // White
	dimColor       = lipgloss.Color("#44475A") // Dark Gray

	// Layout
	appStyle = lipgloss.NewStyle().Margin(1, 2)

	// Header / Tabs
	tabStyle = lipgloss.NewStyle().
			Padding(0, 1).
			Border(lipgloss.RoundedBorder(), false, true, false, true).
			BorderForeground(dimColor).
			Foreground(subtleColor)

	activeTabStyle = tabStyle.Copy().
			BorderForeground(primaryColor).
			Foreground(primaryColor).
			Bold(true)

	tabGap = lipgloss.NewStyle().Width(1)

	filterStyle = lipgloss.NewStyle().
			Foreground(warningColor).
			MarginLeft(2)

	// List
	listStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(subtleColor).
			Padding(0, 1)

	itemStyle = lipgloss.NewStyle().
			PaddingLeft(2)

	selectedItemStyle = lipgloss.NewStyle().
				PaddingLeft(0).
				Foreground(primaryColor).
				Border(lipgloss.NormalBorder(), false, false, false, true).
				BorderForeground(primaryColor).
				Padding(0, 0, 0, 1).
				Bold(true)

	descriptionStyle = lipgloss.NewStyle().
				Foreground(subtleColor)

	// Status Bar
	statusBarStyle = lipgloss.NewStyle().
			Foreground(subtleColor).
			MarginTop(1)

	spinnerStyle = lipgloss.NewStyle().Foreground(secondaryColor)
)
