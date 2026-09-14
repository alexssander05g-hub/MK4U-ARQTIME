/**
 * dom.js — auxiliares mínimos de DOM para as telas (iframes).
 *
 * Segurança / XSS: todo texto vindo do usuário (ex.: nome do card) é inserido
 * via `textContent`, que o navegador trata como texto puro — nunca como HTML.
 * Assim não há caminho para injeção de script. (O Trello também oferece
 * `t.safe(html)` para quando você PRECISA inserir HTML; aqui não precisamos.)
 */

/**
 * Cria um elemento.
 * @param {string} tag
 * @param {object} [props]   ex.: { class:'pill', text:'Olá', title:'...' }
 * @param {Node[]} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;      // <- seguro
    else if (k === 'html') node.innerHTML = v;        // usar só com conteúdo próprio/confiável
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(rootId, node) {
  const root = document.getElementById(rootId);
  clear(root);
  root.appendChild(node);
  return root;
}
