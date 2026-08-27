# @cosmosapp/app_runtime

El runtime declarativo para apps de terceros en la vitrina.

La app corre en un **Web Worker** y nunca toca el DOM. Describe lo que quiere en
pantalla como objetos planos; el anfitrión, en el hilo principal, lo dibuja y le
avisa qué hizo el comprador.

Cero dependencias en producción. Las dos puntas en el mismo paquete.

## Por qué un worker y no un iframe

Las dos formas aíslan la app. La diferencia es el precio.

Un iframe cuesta un documento anidado, con su propio layout, su propio stack de
red y su propio arranque, en una página cuya velocidad **es** la tasa de
conversión del comerciante. Y encima queda fuera del flujo del documento, así
que un widget que tiene que empujar el contenido de abajo no puede.

Un Worker no tiene DOM. La app no es que *no debería* tocar la página: **no
puede**. Es la misma garantía sin el costo, y por eso una vitrina se puede
permitir correr código que el comerciante instaló pero no escribió.

Lo que se paga a cambio es el problema que resuelve este paquete: nada
ejecutable cruza un `postMessage`.

## El truco

`postMessage` usa clonado estructurado, que **explota con funciones**. Pero una
UI sin handlers no sirve.

Entonces el árbol viaja con ids en lugar de funciones:

```
Worker (la app)                    Hilo principal (el anfitrión)
──────────────                     ────────────────────────────
{ onClick: fn }
      │  serialize()
      ▼
{ handlers: { click: "h1" } }  ──▶  render() y addEventListener
                                              │
registry.get("h1")(evento)     ◀──  { handlerId: "h1", event }
```

El registro id→función se queda del lado de la app. El anfitrión **nunca recibe
nada llamable**, que además es el punto: código que corre en la vitrina no
debería poder pasarle una función a la página.

Hay un test que lo verifica con `structuredClone`, que es lo que `postMessage`
usa de verdad.

## Todo árbol es hostil

El renderizador está escrito asumiendo que el árbol quiere hacer daño. No porque
la app sea maliciosa, sino porque el comerciante es quien paga si lo es.

- **Nunca se asigna a `innerHTML`.** El texto va por `textContent`, que no puede
  crear nodos.
- **Los atributos salen de una lista blanca por componente.** Nada de `onerror`,
  `formaction` ni `srcdoc`.
- **Las URLs se parsean y se les mira el esquema.** `javascript:` no llega nunca
  a un `href`. Los caracteres de control se sacan antes de parsear, que es como
  se cuela `java\nscript:`.
- **Las propiedades de estilo salen de otra lista blanca**, y un valor con
  paréntesis se rechaza: `url()`, `expression()` e `image-set()` son formas de
  salirse de la hoja de estilos y ninguna hace falta para maquetar.
- **`target="_blank"` recibe `rel="noopener noreferrer"`.** Sin eso la página
  abierta puede navegar la vitrina a donde quiera.
- **Hay un tope de nodos por árbol** (5000 por defecto). Un bucle sobre un
  catálogo sin paginar congela la página igual que un ataque.

## Uso

En el worker:

```ts
import { createAppRuntime } from "@cosmosapp/app_runtime";

const app = createAppRuntime(self);

app.mount({
  type: "col",
  props: { style: { gap: "8px" } },
  children: [
    { type: "txt", props: { text: "Nota de regalo" } },
    { type: "field", props: { name: "nota", onInput: (e) => guardar(e.value) } },
    { type: "button", props: { text: "Agregar", onClick: () => enviar() } },
  ],
});
```

En la vitrina:

```ts
import { createHostRuntime } from "@cosmosapp/app_runtime";

createHostRuntime({
  container: document.querySelector("#slot-carrito")!,
  channel: new Worker("/apps/nota-de-regalo.js"),
  onRefused: (razon) => console.warn("[app] arbol rechazado:", razon),
});
```

## Lo que hay hoy

Diez componentes: `box`, `row`, `col`, `txt`, `button`, `img`, `link`, `field`,
`check`, `fragment`. Alcanzan para un widget de vitrina real y el resto es
mecánico: una entrada en `TAGS` y otra en `ATTRS`.

**No hay diffing.** `render()` reconstruye. Es a propósito: una primera versión
que reconstruye es honesta sobre lo que hace, y una con diffing que se equivoca
en un caso deja nodos viejos en la página de un comerciante, que es peor que un
repintado. La costura está en esa única función, así que un reconciliador con
claves entra después sin tocar nada más.

## Verificación

```
npm run typecheck    tsc --noEmit, limpio
npm test             28 tests, todos en verde
```

Los tests de sanitización corren contra un DOM real (jsdom), no contra un doble
escrito a mano. Probar que `javascript:` se rechaza contra un DOM falso propio
sólo demuestra que el falso me da la razón; lo que importa es qué hace un
navegador de verdad con eso.

## Licencia

Ver `LICENSE`.
