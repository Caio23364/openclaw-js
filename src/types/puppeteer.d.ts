/**
 * Type declaration shim for puppeteer.
 * Puppeteer is an optional dependency — install it to get full types:
 *   npm install puppeteer
 */
declare module 'puppeteer' {
    export interface LaunchOptions {
        headless?: boolean | 'new';
        args?: string[];
        executablePath?: string;
        userDataDir?: string;
        defaultViewport?: { width: number; height: number } | null;
        timeout?: number;
        ignoreHTTPSErrors?: boolean;
        [key: string]: any;
    }

    export interface Page {
        goto(url: string, options?: any): Promise<any>;
        click(selector: string, options?: any): Promise<void>;
        type(selector: string, text: string, options?: any): Promise<void>;
        evaluate<T>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T>;
        $(selector: string): Promise<ElementHandle | null>;
        $$(selector: string): Promise<ElementHandle[]>;
        screenshot(options?: any): Promise<Buffer>;
        content(): Promise<string>;
        title(): Promise<string>;
        url(): string;
        waitForSelector(selector: string, options?: any): Promise<ElementHandle | null>;
        waitForNavigation(options?: any): Promise<any>;
        setViewport(viewport: { width: number; height: number }): Promise<void>;
        close(): Promise<void>;
        on(event: string, handler: (...args: any[]) => void): void;
        [key: string]: any;
    }

    export interface ElementHandle {
        click(options?: any): Promise<void>;
        type(text: string, options?: any): Promise<void>;
        evaluate<T>(fn: (el: any) => T): Promise<T>;
        screenshot(options?: any): Promise<Buffer>;
        boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
        [key: string]: any;
    }

    export interface Browser {
        newPage(): Promise<Page>;
        pages(): Promise<Page[]>;
        close(): Promise<void>;
        createBrowserContext(): Promise<BrowserContext>;
        defaultBrowserContext(): BrowserContext;
        version(): Promise<string>;
        isConnected(): boolean;
        [key: string]: any;
    }

    export interface BrowserContext {
        newPage(): Promise<Page>;
        pages(): Promise<Page[]>;
        close(): Promise<void>;
        [key: string]: any;
    }

    interface PuppeteerNode {
        launch(options?: LaunchOptions): Promise<Browser>;
        connect(options?: any): Promise<Browser>;
    }

    const puppeteer: PuppeteerNode;
    export default puppeteer;
}
