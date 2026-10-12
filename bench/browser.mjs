import { chromium } from '@playwright/test';

// Uses the Chromium at CHROMIUM_PATH if set, otherwise Playwright's own copy
// (install it once with `npx playwright install chromium`).
export const launch = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
