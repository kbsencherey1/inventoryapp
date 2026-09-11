# Stockroom visual system

## Direction

The receiving desk is a calm, high-trust work surface: a dark navigation rail establishes the workspace, while a paper-white content area keeps operational tables legible. The signature interaction is a line-level count table where ordered, counted, variance, and status are always adjacent.

## Scene

Receivers use the app at a desk or receiving bay under ordinary overhead light. The UI uses a light content surface with a dark slate rail so a count remains readable on a laptop or tablet without relying on saturated color.

## Tokens

- Ink: `#162230`
- Muted text: `#637081`
- Content surface: `#F8FAFC`
- Panel: `#FFFFFF`
- Navigation: `#162230`
- Primary action: `#1665D8`
- Positive: `#19734A`
- Variance warning: `#9A5F12`
- Error/short: `#B34747`
- Borders: `#DBE1E8`
- Radius: 7px controls, 10px panels
- Typography: Aptos / Segoe UI Variable / Segoe UI system sans stack

## Components

The UI uses a consistent button vocabulary, semantic status badges, dense responsive tables, inline forms, and a restrained metric row. Disabled future capability is explicitly labelled rather than represented as fake automation. Focus rings use a blue outline, and every destructive or inventory-changing action is a deliberate primary confirmation.

## Responsive rules

At smaller widths the rail becomes an off-canvas navigation menu, the top bar keeps only the current title and menu control, metrics become a two-column grid, and receiving confirmation stacks below the table. Tables remain horizontally scrollable so data is not silently truncated.
