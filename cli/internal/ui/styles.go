package ui

import (
	"github.com/charmbracelet/lipgloss"
)

var (
	// Colors
	ColorBackground = lipgloss.Color("234")
	ColorForeground = lipgloss.Color("252")
	ColorDim        = lipgloss.Color("240")
	ColorAccent     = lipgloss.Color("99")  // Purple
	ColorSuccess    = lipgloss.Color("42")  // Green
	ColorError      = lipgloss.Color("196") // Red
	ColorWarning    = lipgloss.Color("214") // Orange
	ColorHighlight  = lipgloss.Color("63")  // Blue-ish purple for selection

	// Layout
	StyleApp = lipgloss.NewStyle().
			Padding(1, 2)

	// Header
	StyleHeader = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorDim).
			Padding(0, 1).
			MarginBottom(1)

	StyleTabActive = lipgloss.NewStyle().
			Bold(true).
			Foreground(ColorAccent).
			Border(lipgloss.NormalBorder(), false, false, true, false).
			BorderForeground(ColorAccent).
			Padding(0, 2)

	StyleTabInactive = lipgloss.NewStyle().
				Foreground(ColorDim).
				Padding(0, 2)

	StyleFilterBar = lipgloss.NewStyle().
			MarginTop(0).
			Padding(0, 1).
			Foreground(ColorDim)

	StyleFilterActive = lipgloss.NewStyle().
				Foreground(ColorWarning).
				Bold(true)

	// List Items
	StyleItem = lipgloss.NewStyle().
			PaddingLeft(2)

	StyleItemRepo = lipgloss.NewStyle().
			Bold(true).
			Foreground(ColorForeground)

	StyleItemPath = lipgloss.NewStyle().
			Foreground(ColorDim).
			Italic(true)

	StyleItemSelected = lipgloss.NewStyle().
				Border(lipgloss.NormalBorder(), false, false, false, true).
				BorderForeground(ColorAccent).
				PaddingLeft(1).
				Foreground(ColorAccent)

	// Status Badges
	StyleBadgeDirty = lipgloss.NewStyle().
			Foreground(ColorWarning).
			SetString("●")

	StyleBadgeClean = lipgloss.NewStyle().
			Foreground(ColorSuccess).
			SetString("✓")

	StyleBadgeActive = lipgloss.NewStyle().
				Foreground(ColorSuccess).
				Bold(true).
				SetString("⚡")
)
