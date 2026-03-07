declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export const gfm: (
    service: TurndownService,
  ) => void | { rules?: unknown[]; [key: string]: unknown };
}
