package ui

import "github.com/charmbracelet/lipgloss"

var (
	// Palette (VS Code / Modern Industrial)
	// High contrast, clean, utilitarian.
	cPrimary    = lipgloss.Color("#58A6FF") // Bright Blue
	cSecondary  = lipgloss.Color("#8B949E") // Medium Gray
	cSuccess    = lipgloss.Color("#238636") // Green
	cWarning    = lipgloss.Color("#D29922") // Orange
	cError      = lipgloss.Color("#F85149") // Red
	cText       = lipgloss.Color("#C9D1D9") // Main Text
	cSubtle     = lipgloss.Color("#6E7681") // Subtle Text/Comments
	cDim        = lipgloss.Color("#484F58") // Very Dim / Borders
	cBgSelected = lipgloss.Color("#161B22") // List Selection BG

	// Semantic mappings (Keeping names for compatibility with model.go)
	primaryColor   = cPrimary
	secondaryColor = cSubtle
	subtleColor    = cSubtle
	warningColor   = cWarning
	errorColor     = cError
	successColor   = cSuccess
	textColor      = cText
	dimColor       = cDim

	// Layout
	appStyle = lipgloss.NewStyle().Margin(1, 1)

	// Tabs: Pill Style
	tabStyle = lipgloss.NewStyle().
			Foreground(cSubtle).
			Padding(0, 1).
			MarginRight(1)

	activeTabStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#FFFFFF")).
			Background(cPrimary).
			Padding(0, 2).
			Bold(true).
			MarginRight(1)

	tabGap = lipgloss.NewStyle().Width(1)

	filterStyle = lipgloss.NewStyle().
			Foreground(cWarning).
			Bold(true).
			MarginLeft(2)

	// List
	listStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(cDim).
			Padding(0, 0)

	// Item Styles
	itemStyle = lipgloss.NewStyle().
			PaddingLeft(1).
			PaddingRight(1).
			Border(lipgloss.HiddenBorder(), false, false, false, true).
			BorderForeground(lipgloss.Color("0")) // Transparent

	selectedItemStyle = lipgloss.NewStyle().
				PaddingLeft(1).
				PaddingRight(1).
				Border(lipgloss.ThickBorder(), false, false, false, true).
				BorderForeground(cPrimary).
				Background(cBgSelected)

	// Text Styles for Delegate
	repoNameStyle = lipgloss.NewStyle().
			Foreground(cText).
			Bold(true)

	pathStyle = lipgloss.NewStyle().
			Foreground(cDim).
			Italic(true)

	statusStyle = lipgloss.NewStyle().
			Foreground(cSubtle).
			PaddingLeft(1)

	statusDirtyStyle = lipgloss.NewStyle().
				Foreground(cWarning).
				Bold(true).
				PaddingLeft(1)

	// Status Bar
	statusBarStyle = lipgloss.NewStyle().
			Foreground(cSubtle).
			MarginTop(0).
			Padding(0, 1)

	spinnerStyle = lipgloss.NewStyle().Foreground(cPrimary)
)
