/**
 * The declarative runtime for Cosmos Apps in a storefront.
 *
 * An app runs in a Web Worker and never touches the DOM. It describes what it
 * wants on screen as plain objects; the host, on the main thread, renders that
 * description and reports back what the shopper did.
 *
 * That split is what makes third-party code in a merchant's storefront
 * affordable. An iframe would also isolate the app, but it costs a nested
 * document, its own layout and its own network stack on a page whose speed is
 * the merchant's conversion rate. A Worker has no DOM to abuse in the first
 * place.
 */
export { createAppRuntime, type AppRuntime, type Channel } from "./app";
export {
	createHostRuntime,
	type HostChannel,
	type HostRuntime,
	type HostRuntimeOptions,
} from "./host";
export { render, type EventSink } from "./render";
export { HandlerRegistry, serialize } from "./serialize";
export type {
	AppEvent,
	AppMessage,
	ComponentType,
	Element,
	EventHandler,
	HostMessage,
	Node,
	Props,
	Style,
	WireElement,
	WireNode,
	WireProps,
} from "./types";
