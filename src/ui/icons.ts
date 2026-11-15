// 24×24 stroke icons (paths only); rendered by Icon.svelte.
export const icons = {
  dashboard: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
  chat: 'M5 5h14v10H9l-4 4z',
  automations: 'M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5 6.8 15M17.2 9l2.6-1.5M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  alert: 'M12 4 3 20h18zM12 10v4M12 17v.5',
  stop: 'M8 3h8l5 5v8l-5 5H8l-5-5V8zM12 8v5M12 16v.5',
  check: 'M5 12.5 10 17 19 7',
  x: 'M6 6l12 12M18 6 6 18',
  send: 'M4 12 20 4l-6 16-3-7z',
  play: 'M8 5v14l11-7z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  search: 'M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-4.5-4.5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  down: 'M6 9l6 6 6-6',
} as const;
export type IconName = keyof typeof icons;
