/// <reference types="vite/client" />

interface Window {
	grecaptcha: {
		ready(callback: () => void): void;
		execute(siteKey: string, options: { action: string }): Promise<string>;
	};
	google?: {
		accounts: {
			id: {
				initialize(config: { client_id: string; callback: (response: { credential: string }) => void }): void;
				renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
			};
		};
	};
}
