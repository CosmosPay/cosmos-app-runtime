// The round trip: an app describes a tree, the host renders it, a shopper
// clicks, and the app's handler runs. Plus the boundary itself, which is the
// part that has to hold: nothing callable may cross it.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let createAppRuntime, createHostRuntime, serialize, HandlerRegistry;

before(async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://tienda.cosmospay.lat/',
  });
  for (const k of [
    'window', 'document', 'HTMLElement', 'HTMLInputElement',
    'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLImageElement',
    'HTMLAnchorElement', 'HTMLButtonElement',
  ]) {
    globalThis[k] = k === 'window' ? dom.window
      : k === 'document' ? dom.window.document
      : dom.window[k];
  }
  ({ createAppRuntime, createHostRuntime, serialize, HandlerRegistry } =
    await import('../dist/index.js'));
});

/** A pair of channels wired to each other, standing in for a Worker. */
function pareja() {
  const aApp = new Set();
  const aHost = new Set();
  const app = {
    postMessage: (m) => queueMicrotask(() => aHost.forEach((f) => f({ data: m }))),
    addEventListener: (_t, f) => aApp.add(f),
    removeEventListener: (_t, f) => aApp.delete(f),
  };
  const host = {
    postMessage: (m) => queueMicrotask(() => aApp.forEach((f) => f({ data: m }))),
    addEventListener: (_t, f) => aHost.add(f),
    removeEventListener: (_t, f) => aHost.delete(f),
  };
  return { app, host };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// -- the boundary -------------------------------------------------------------

test('no function survives serialization', () => {
  const registry = new HandlerRegistry();
  const wire = serialize(
    {
      type: 'button',
      props: { text: 'go', onClick: () => 'secreto' },
      children: [{ type: 'txt', props: { text: 'x', onChange: () => 1 } }],
    },
    registry,
  );

  const json = JSON.stringify(wire);
  assert.doesNotMatch(json, /secreto/, 'the handler body did not travel');
  assert.doesNotMatch(json, /=>/, 'no arrow function in the wire tree');

  // structuredClone is what postMessage really uses; it throws on functions.
  assert.doesNotThrow(() => structuredClone(wire));
});

test('a handler becomes an id and the id resolves back to it', () => {
  const registry = new HandlerRegistry();
  let llamado = false;
  const wire = serialize(
    { type: 'button', props: { onClick: () => { llamado = true; } } },
    registry,
  );

  const id = wire.props.handlers.click;
  assert.ok(id, 'the click handler got an id');
  registry.get(id)({ type: 'click' });
  assert.equal(llamado, true);
});

test('serializing a new tree forgets the handlers of the old one', () => {
  const registry = new HandlerRegistry();
  serialize({ type: 'button', props: { onClick: () => {} } }, registry);
  assert.equal(registry.size, 1);
  serialize({ type: 'box' }, registry);
  assert.equal(registry.size, 0, 'the registry does not grow forever');
});

test('falsy children are dropped so conditionals need no special case', () => {
  const registry = new HandlerRegistry();
  const wire = serialize(
    { type: 'box', children: ['a', null, false, undefined, 'b'] },
    registry,
  );
  assert.deepEqual(wire.children, ['a', 'b']);
});

test('a numeric child becomes text', () => {
  const registry = new HandlerRegistry();
  const wire = serialize({ type: 'box', children: [42] }, registry);
  assert.deepEqual(wire.children, ['42']);
});

// -- the round trip -----------------------------------------------------------

test('an app describes a tree, the host renders it', async () => {
  const { app: canalApp, host: canalHost } = pareja();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const host = createHostRuntime({ container, channel: canalHost });
  const app = createAppRuntime(canalApp);

  app.mount({
    type: 'col',
    children: [
      { type: 'txt', props: { text: 'Nota de regalo' } },
      { type: 'button', props: { text: 'Agregar' } },
    ],
  });

  await app.ready();

  assert.equal(container.querySelector('span').textContent, 'Nota de regalo');
  assert.equal(container.querySelector('button').textContent, 'Agregar');
  assert.equal(host.renderCount, 1);

  host.destroy();
  app.destroy();
});

test('a click in the storefront runs the handler in the app', async () => {
  const { app: canalApp, host: canalHost } = pareja();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const host = createHostRuntime({ container, channel: canalHost });
  const app = createAppRuntime(canalApp);

  let clicks = 0;
  app.mount({
    type: 'button',
    props: { text: 'Agregar', onClick: () => { clicks += 1; } },
  });
  await app.ready();

  container.querySelector('button').click();
  await tick();

  assert.equal(clicks, 1);
  host.destroy();
  app.destroy();
});

test('the value of an input reaches the app', async () => {
  const { app: canalApp, host: canalHost } = pareja();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const host = createHostRuntime({ container, channel: canalHost });
  const app = createAppRuntime(canalApp);

  let visto = null;
  app.mount({
    type: 'field',
    props: { name: 'nota', onInput: (e) => { visto = e; } },
  });
  await app.ready();

  const input = container.querySelector('input');
  input.value = 'feliz cumple';
  input.dispatchEvent(new window.Event('input'));
  await tick();

  assert.equal(visto.value, 'feliz cumple');
  assert.equal(visto.name, 'nota');
  assert.equal(visto.type, 'input');

  host.destroy();
  app.destroy();
});

test('a handler that throws does not stop the next event', async () => {
  const { app: canalApp, host: canalHost } = pareja();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const host = createHostRuntime({ container, channel: canalHost });
  const app = createAppRuntime(canalApp);

  let segundos = 0;
  app.mount({
    type: 'row',
    children: [
      { type: 'button', props: { text: 'malo', onClick: () => { throw new Error('boom'); } } },
      { type: 'button', props: { text: 'bueno', onClick: () => { segundos += 1; } } },
    ],
  });
  await app.ready();

  const [malo, bueno] = container.querySelectorAll('button');
  const errorOriginal = console.error;
  console.error = () => {};
  malo.click();
  await tick();
  console.error = errorOriginal;

  bueno.click();
  await tick();

  assert.equal(segundos, 1, 'the loop survived the throw');
  host.destroy();
  app.destroy();
});

test('unmount clears the container', async () => {
  const { app: canalApp, host: canalHost } = pareja();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const host = createHostRuntime({ container, channel: canalHost });
  const app = createAppRuntime(canalApp);

  app.mount({ type: 'txt', props: { text: 'hola' } });
  await app.ready();
  assert.ok(container.childNodes.length > 0);

  app.unmount();
  await tick();
  assert.equal(container.childNodes.length, 0);

  host.destroy();
  app.destroy();
});

// -- the limits ---------------------------------------------------------------

test('a tree over the node limit is refused instead of rendered', async () => {
  const { app: canalApp, host: canalHost } = pareja();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const razones = [];
  const host = createHostRuntime({
    container,
    channel: canalHost,
    maxNodes: 10,
    onRefused: (r) => razones.push(r),
  });
  const app = createAppRuntime(canalApp);

  app.mount({
    type: 'box',
    children: Array.from({ length: 50 }, (_, i) => ({
      type: 'txt',
      props: { text: String(i) },
    })),
  });
  await tick();
  await tick();

  assert.equal(container.childNodes.length, 0, 'nothing was rendered');
  assert.equal(razones.length, 1);
  assert.match(razones[0], /more than 10 nodes/);

  host.destroy();
  app.destroy();
});

test('a stale handler id is ignored rather than throwing', async () => {
  const { app: canalApp, host: canalHost } = pareja();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const host = createHostRuntime({ container, channel: canalHost });
  const app = createAppRuntime(canalApp);

  app.mount({ type: 'button', props: { onClick: () => {} } });
  await app.ready();

  // The host sends an event for a handler the app no longer knows about,
  // which is what happens when a tree is replaced while an event is in flight.
  canalHost.postMessage({ kind: 'event', handlerId: 'h999', event: { type: 'click' } });
  await tick();

  assert.ok(true, 'no throw');
  host.destroy();
  app.destroy();
});
