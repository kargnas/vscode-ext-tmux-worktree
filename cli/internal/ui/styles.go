package ui

import "github.com/charmbracelet/lipgloss"

// Color palette constants
const (
	// Active/Selected colors
	ActiveColor    = lipgloss.Color("#00D9FF") // cyan
	SelectedColor  = lipgloss.Color("#FFEB3B") // yellow
	HighlightColor = lipgloss.Color("#FFF9C4") // light yellow

	// Inactive/Normal colors
	InactiveColor = lipgloss.Color("#B0BEC5") // gray
	DimColor      = lipgloss.Color("#78909C") // dim gray

	// Status colors
	DirtyColor   = lipgloss.Color("#FFC107") // yellow/amber
	ErrorColor   = lipgloss.Color("#F44336") // red
	SuccessColor = lipgloss.Color("#4CAF50") // green

	// UI element colors
	HelpColor    = lipgloss.Color("#90CAF9") // light blue
	TitleColor   = lipgloss.Color("#4CAF50") // green
	WarningColor = lipgloss.Color("#FF9800") // orange
)

// Tab styles for Tab UI layout
var (
	TabActiveStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ActiveColor).
			Foreground(ActiveColor).
			Bold(true).
			Padding(0, 2)

	TabInactiveStyle = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(InactiveColor).
				Foreground(InactiveColor).
				Padding(0, 2)

	TabGapStyle = lipgloss.NewStyle().
			Foreground(DimColor)
)

// Status indicator styles
var (
	// ActiveIndicatorStyle: "●" for active sessions (cyan)
	ActiveIndicatorStyle = lipgloss.NewStyle().
				Foreground(ActiveColor).
				Bold(true)

	// InactiveIndicatorStyle: "○" for inactive worktrees (gray)
	InactiveIndicatorStyle = lipgloss.NewStyle().
				Foreground(InactiveColor)
)

// Git status display styles
var (
	// DirtyStyle: modified files indicator (yellow/amber)
	DirtyStyle = lipgloss.NewStyle().
			Foreground(DirtyColor).
			Bold(true)

	// LoadingStyle: "..." loading indicator (dim gray)
	LoadingStyle = lipgloss.NewStyle().
			Foreground(DimColor).
			Italic(true)

	// ErrorStyle: "--" error indicator (red)
	ErrorStyle = lipgloss.NewStyle().
			Foreground(ErrorColor)
)

// Time display style
var (
	TimeStyle = lipgloss.NewStyle().
			Foreground(DimColor)

	DimStyle = lipgloss.NewStyle().
			Foreground(DimColor)
)

// Filter checkbox styles
var (
	// FilterActiveStyle: checked state
	FilterActiveStyle = lipgloss.NewStyle().
				Foreground(ActiveColor).
				Bold(true)

	// FilterInactiveStyle: unchecked state
	FilterInactiveStyle = lipgloss.NewStyle().
				Foreground(InactiveColor)
)

// List item styles (for bubble tea list component)
var (
	// NormalTitle: 일반 상태 제목 스타일 (cyan, bold)
	NormalTitle = lipgloss.NewStyle().
			Foreground(ActiveColor).
			Bold(true).
			Padding(0, 1)

	// SelectedTitle: 선택된 상태 제목 스타일 (yellow, bold)
	SelectedTitle = lipgloss.NewStyle().
			Foreground(SelectedColor).
			Bold(true).
			Padding(0, 1)

	// NormalDesc: 일반 상태 설명 스타일 (gray)
	NormalDesc = lipgloss.NewStyle().
			Foreground(InactiveColor)

	// SelectedDesc: 선택된 상태 설명 스타일 (light yellow)
	SelectedDesc = lipgloss.NewStyle().
			Foreground(HighlightColor)

	// HelpStyle: 도움말 스타일 (light blue)
	HelpStyle = lipgloss.NewStyle().
			Foreground(HelpColor).
			Padding(1, 0)

	// ListTitleStyle: 리스트 제목 스타일 (green, bold)
	ListTitleStyle = lipgloss.NewStyle().
			Foreground(TitleColor).
			Bold(true).
			Padding(1, 2)

	// EmptyStyle: 빈 상태 경고 스타일 (orange, bold)
	EmptyStyle = lipgloss.NewStyle().
			Foreground(WarningColor).
			Bold(true).
			Padding(2, 4)

	// HintStyle: 힌트 메시지 스타일 (light blue)
	HintStyle = lipgloss.NewStyle().
			Foreground(HelpColor).
			Padding(1, 4)
)
