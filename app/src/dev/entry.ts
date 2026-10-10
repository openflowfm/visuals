// `npm run dev`'s first script, before `main.tsx` (`vite.dev.config.ts` puts it there).
import { install } from './bridge.ts';

install();
