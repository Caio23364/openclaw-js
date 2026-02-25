/**
 * OpenClaw - Browser Control
 * Lazy-loaded Puppeteer-based browser automation (picoclaw-inspired optimization)
 * Puppeteer is only imported when a browser session is actually launched.
 */

import { log } from '../utils/logger.js';
import { BrowserSession, ViewportConfig } from '../types/index.js';
import { generateId } from '../utils/helpers.js';

export interface BrowserProfile {
  name: string;
  userDataDir?: string;
  viewport?: ViewportConfig;
  userAgent?: string;
}

// Lazy-loaded puppeteer types
type Browser = any;
type Page = any;
type BrowserContext = any;
type LaunchOptions = any;

// Cache the puppeteer module once loaded
let puppeteerModule: any = null;

async function getPuppeteer(): Promise<any> {
  if (!puppeteerModule) {
    log.info('Lazy-loading Puppeteer...');
    puppeteerModule = await import('puppeteer');
    log.info('Puppeteer loaded successfully');
  }
  return puppeteerModule.default || puppeteerModule;
}

export class BrowserManager {
  private browsers: Map<string, Browser>;
  private contexts: Map<string, BrowserContext>;
  private pages: Map<string, Page>;
  private sessions: Map<string, BrowserSession>;

  constructor() {
    this.browsers = new Map();
    this.contexts = new Map();
    this.pages = new Map();
    this.sessions = new Map();
  }

  public async launchBrowser(
    profile: BrowserProfile,
    options: LaunchOptions = {}
  ): Promise<string> {
    const id = generateId();
    const puppeteer = await getPuppeteer();

    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
      ],
      ...options,
    };

    if (profile.userDataDir) {
      launchOptions.userDataDir = profile.userDataDir;
    }

    log.info(`Launching browser: ${profile.name}`);
    const browser = await puppeteer.launch(launchOptions);
    this.browsers.set(id, browser);

    const context = await browser.createBrowserContext();
    this.contexts.set(id, context);

    const page = await context.newPage();
    this.pages.set(id, page);

    if (profile.viewport) {
      await page.setViewport({
        width: profile.viewport.width || 1280,
        height: profile.viewport.height || 720,
        deviceScaleFactor: profile.viewport.deviceScaleFactor || 1,
      });
    }

    if (profile.userAgent) {
      await page.setUserAgent(profile.userAgent);
    }

    const session: BrowserSession = {
      id,
      profile: profile.name,
      url: 'about:blank',
      status: 'idle',
      viewport: {
        width: profile.viewport?.width || 1280,
        height: profile.viewport?.height || 720,
        deviceScaleFactor: profile.viewport?.deviceScaleFactor || 1,
        isMobile: false,
        hasTouch: false,
      },
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.sessions.set(id, session);
    log.info(`Browser launched: ${id}`);

    return id;
  }

  public async navigate(browserId: string, url: string): Promise<void> {
    const page = this.pages.get(browserId);
    if (!page) throw new Error(`Browser not found: ${browserId}`);

    log.info(`Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    const session = this.sessions.get(browserId);
    if (session) {
      session.url = url;
      session.lastActivity = new Date();
    }
  }

  public async click(browserId: string, selector: string): Promise<void> {
    const page = this.pages.get(browserId);
    if (!page) throw new Error(`Browser not found: ${browserId}`);

    await page.waitForSelector(selector, { timeout: 5000 });
    await page.click(selector);
    this.updateLastActivity(browserId);
  }

  public async type(browserId: string, selector: string, text: string): Promise<void> {
    const page = this.pages.get(browserId);
    if (!page) throw new Error(`Browser not found: ${browserId}`);

    await page.waitForSelector(selector, { timeout: 5000 });
    await page.type(selector, text);
    this.updateLastActivity(browserId);
  }

  public async fill(browserId: string, selector: string, value: string): Promise<void> {
    const page = this.pages.get(browserId);
    if (!page) throw new Error(`Browser not found: ${browserId}`);

    await page.waitForSelector(selector, { timeout: 5000 });
    await page.$eval(
      selector,
      (el: any, val: string) => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
      value
    );
    this.updateLastActivity(browserId);
  }

  public async scroll(browserId: string, direction: 'up' | 'down' | 'left' | 'right', amount: number = 500): Promise<void> {
    const page = this.pages.get(browserId);
    if (!page) throw new Error(`Browser not found: ${browserId}`);

    const scrollMap = {
      up: [0, -amount],
      down: [0, amount],
      left: [-amount, 0],
      right: [amount, 0],
    };

    const [x, y] = scrollMap[direction];
    await page.evaluate((sx: number, sy: number) => window.scrollBy(sx, sy), x, y);
    this.updateLastActivity(browserId);
  }

  public async screenshot(browserId: string, options: { fullPage?: boolean; selector?: string } = {}): Promise<Buffer> {
    const page = this.pages.get(browserId);
    if (!page) throw new Error(`Browser not found: ${browserId}`);

    this.updateLastActivity(browserId);

    if (options.selector) {
      const element = await page.$(options.selector);
      if (!element) throw new Error(`Element not found: ${options.selector}`);
      return element.screenshot({ type: 'png' });
    }

    return page.screenshot({
      type: 'png',
      fullPage: options.fullPage ?? false,
    });
  }

  public async getText(browserId: string, selector?: string): Promise<string> {
    const page = this.pages.get(browserId);
    if (!page) throw new Error(`Browser not found: ${browserId}`);

    this.updateLastActivity(browserId);

    if (selector) {
      return page.$eval(selector, (el: any) => el.textContent || '');
    }

    return page.evaluate(() => document.body.textContent || '');
  }

  public async getHtml(browserId: string, selector?: string): Promise<string> {
    const page = this.pages.get(browserId);
    if (!page) throw new Error(`Browser not found: ${browserId}`);

    this.updateLastActivity(browserId);

    if (selector) {
      return page.$eval(selector, (el: any) => el.innerHTML);
    }

    return page.evaluate(() => document.documentElement.outerHTML);
  }

  public async evaluate(browserId: string, script: string): Promise<any> {
    const page = this.pages.get(browserId);
    if (!page) throw new Error(`Browser not found: ${browserId}`);

    this.updateLastActivity(browserId);

    return page.evaluate(script);
  }

  public async waitForSelector(browserId: string, selector: string, timeout: number = 5000): Promise<void> {
    const page = this.pages.get(browserId);
    if (!page) throw new Error(`Browser not found: ${browserId}`);
    await page.waitForSelector(selector, { timeout });
  }

  public async waitForNavigation(browserId: string, timeout: number = 30000): Promise<void> {
    const page = this.pages.get(browserId);
    if (!page) throw new Error(`Browser not found: ${browserId}`);
    await page.waitForNavigation({ timeout });
  }

  public async closeBrowser(browserId: string): Promise<void> {
    const browser = this.browsers.get(browserId);
    if (browser) {
      await browser.close().catch(() => { });
      this.browsers.delete(browserId);
      this.contexts.delete(browserId);
      this.pages.delete(browserId);

      const session = this.sessions.get(browserId);
      if (session) {
        session.status = 'idle';
      }
      this.sessions.delete(browserId);

      log.info(`Browser closed: ${browserId}`);
    }
  }

  public async closeAll(): Promise<void> {
    log.info('Closing all browsers...');
    const tasks = Array.from(this.browsers.keys()).map(async (id) => {
      try {
        await this.closeBrowser(id);
      } catch (error) {
        log.error(`Failed to close browser ${id}:`, error);
      }
    });
    await Promise.allSettled(tasks);
    this.browsers.clear();
    this.contexts.clear();
    this.pages.clear();
    this.sessions.clear();
  }

  public getPage(browserId: string): Page | undefined {
    const page = this.pages.get(browserId);
    if (page) {
      this.updateLastActivity(browserId);
    }
    return page;
  }

  public updateLastActivity(browserId: string): void {
    const session = this.sessions.get(browserId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  public getSession(browserId: string): BrowserSession | undefined {
    return this.sessions.get(browserId);
  }

  public getAllSessions(): BrowserSession[] {
    return Array.from(this.sessions.values());
  }
}

// Singleton instance
let browserManager: BrowserManager | null = null;

export function getBrowserManager(): BrowserManager {
  if (!browserManager) {
    browserManager = new BrowserManager();
  }
  return browserManager;
}

export function createBrowserManager(): BrowserManager {
  browserManager = new BrowserManager();
  return browserManager;
}

export default BrowserManager;
