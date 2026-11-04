import { ResizableNodeView } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

/** Modos de posicionamiento de una imagen en el documento. */
export type ImageFloat = 'none' | 'left' | 'right' | 'behind';

export interface ImageNodeAttrs {
  src: string | null;
  alt: string | null;
  title: string | null;
  width: number | null;
  height: number | null;
  float: ImageFloat;
  align: 'left' | 'center' | 'right';
  offsetX: number;
  offsetY: number;
}

/** Construye el `style` inline coherente entre editor, vista previa y PDF. */
export function imageStyle(
  attrs: Partial<ImageNodeAttrs>,
  options: { absolute?: boolean } = {},
): string {
  const parts: string[] = [];
  const width = Number(attrs.width) || 0;
  const height = Number(attrs.height) || 0;
  const offsetX = Number(attrs.offsetX) || 0;
  const offsetY = Number(attrs.offsetY) || 0;
  const float = attrs.float ?? 'none';
  const align = attrs.align ?? 'center';

  if (width > 0) parts.push(`width:${width}px`);
  if (height > 0) parts.push(`height:${height}px`);

  if (float === 'behind') {
    // Marca de agua: fuera del flujo, el texto pasa por encima.
    if (options.absolute !== false) {
      parts.push('position:absolute');
      parts.push(`left:${offsetX}px`);
      parts.push(`top:${offsetY}px`);
    }
    parts.push('z-index:-1');
    parts.push('margin:0');
  } else if (float === 'left') {
    parts.push('float:left');
    parts.push(`margin-left:${offsetX}px`);
    parts.push(`margin-top:${offsetY}px`);
    parts.push('margin-right:14px');
    parts.push('margin-bottom:8px');
  } else if (float === 'right') {
    parts.push('float:right');
    parts.push(`margin-right:${offsetX}px`);
    parts.push(`margin-top:${offsetY}px`);
    parts.push('margin-left:14px');
    parts.push('margin-bottom:8px');
  } else {
    parts.push('display:block');
    if (align === 'center') {
      parts.push('margin-left:auto');
      parts.push('margin-right:auto');
    } else if (align === 'right') {
      parts.push('margin-left:auto');
      parts.push('margin-right:0');
    } else {
      parts.push('margin-left:0');
      parts.push('margin-right:auto');
    }
    if (offsetY !== 0) parts.push(`margin-top:${offsetY}px`);
  }

  return parts.join(';');
}

/**
 * Vista de nodo para la imagen: combina el redimensionado por esquinas
 * (ResizableNodeView) con el arrastre libre cuando la imagen flota
 * (float left/right/behind). El arrastre ajusta offsetX/offsetY en px.
 */
export function createImageNodeView(config: {
  node: PMNode;
  editor: Editor;
  getPos: () => number | undefined;
  HTMLAttributes: Record<string, unknown>;
}) {
  const { node, editor, getPos } = config;

  const wrapper = document.createElement('div');
  wrapper.className = 'wp-image';

  const img = document.createElement('img');
  img.draggable = false;
  img.className = 'wp-image__el';

  const initialAttrs = node.attrs as ImageNodeAttrs;
  if (initialAttrs.src) img.src = initialAttrs.src;
  if (initialAttrs.alt) img.alt = initialAttrs.alt;
  if (initialAttrs.title) img.title = initialAttrs.title;

  /** Atributos vivos del nodo en el documento (no los capturados al crear la vista). */
  function currentAttrs(fallback: ImageNodeAttrs | Record<string, unknown> = initialAttrs): ImageNodeAttrs {
    const pos = getPos();
    const live = pos !== undefined ? editor.state.doc.nodeAt(pos)?.attrs : undefined;
    return (live ?? fallback) as ImageNodeAttrs;
  }

  function applyStyles(fallback?: ImageNodeAttrs | Record<string, unknown>): void {
    const current = currentAttrs(fallback);
    wrapper.dataset.float = String(current.float ?? 'none');
    wrapper.dataset.align = String(current.align ?? 'center');
    // En el editor el posicionamiento absoluto se aplica al contenedor del
    // nodo (la imagen vive dentro de la vista de nodo redimensionable).
    if (current.float === 'behind') {
      wrapper.style.position = 'absolute';
      wrapper.style.left = `${Number(current.offsetX) || 0}px`;
      wrapper.style.top = `${Number(current.offsetY) || 0}px`;
    } else {
      wrapper.style.position = '';
      wrapper.style.left = '';
      wrapper.style.top = '';
    }
    const style = imageStyle(current, { absolute: false });
    if (img.getAttribute('style') !== style) img.setAttribute('style', style);
  }

  /**
   * Actualiza atributos del nodo por posición, sin depender de que esté
   * seleccionado (el arrastre puede ocurrir con el foco en otro sitio).
   */
  function commitAttrs(values: Record<string, unknown>): void {
    const pos = getPos();
    if (pos === undefined) return;
    const current = editor.state.doc.nodeAt(pos);
    if (!current) return;
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
      ...current.attrs,
      ...values,
    });
    editor.view.dispatch(tr);
  }

  applyStyles();

  // ── Redimensionado por esquinas (manejo nativo de TipTap) ──
  const resizeView = new ResizableNodeView({
    element: img,
    editor,
    node,
    getPos,
    onResize: (width, height) => {
      img.style.width = `${width}px`;
      img.style.height = `${height}px`;
    },
    onCommit: (width, height) => {
      commitAttrs({ width, height });
    },
    onUpdate: (updatedNode) => {
      if (updatedNode.type !== node.type) return false;
      const a = currentAttrs(updatedNode.attrs);
      if (a.src && img.getAttribute('src') !== a.src) img.src = a.src;
      if (a.alt != null) img.alt = a.alt;
      if (a.title != null) img.title = a.title;
      applyStyles(updatedNode.attrs);
      return true;
    },
    options: {
      directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
      min: { width: 60, height: 40 },
      preserveAspectRatio: true,
    },
  });

  wrapper.appendChild(resizeView.dom);

  // ── Arrastre libre (solo en modos flotantes) ──
  let dragging = false;
  let pending = false;
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let baseY = 0;
  let dragSign = 1;

  function onPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    // Los tiradores de redimensionado gestionan su propio arrastre.
    if (target.closest('[data-resize-handle]')) return;
    const current = currentAttrs();
    if (current.float === 'none') return; // en modo bloque no se arrastra

    pending = true;
    dragging = false;
    startX = event.clientX;
    startY = event.clientY;
    baseX = Number(current.offsetX) || 0;
    baseY = Number(current.offsetY) || 0;
    // En un flotante derecho el margen se mide desde el borde derecho.
    dragSign = current.float === 'right' ? -1 : 1;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp, { once: true });
    document.addEventListener('pointercancel', onPointerUp, { once: true });
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pending && !dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    // Umbral para no interferir con el clic de selección.
    if (!dragging && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    if (!dragging) {
      dragging = true;
      wrapper.classList.add('is-dragging');
    }
    event.preventDefault();
    commitAttrs({
      offsetX: Math.max(0, Math.round(baseX + dragSign * dx)),
      offsetY: Math.max(0, Math.round(baseY + dy)),
    });
  }

  function onPointerUp(): void {
    pending = false;
    dragging = false;
    wrapper.classList.remove('is-dragging');
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);
  }

  // Evita que el navegador inicie el arrastre nativo del contenido editable
  // (dragstart) mientras movemos la imagen flotante.
  function onDragStart(event: DragEvent): void {
    if (pending || dragging) event.preventDefault();
  }

  wrapper.addEventListener('dragstart', onDragStart);
  wrapper.addEventListener('pointerdown', onPointerDown);

  return {
    dom: wrapper,
    update: (updatedNode: PMNode, decorations: readonly unknown[], innerDecorations: unknown) => {
      if (updatedNode.type !== node.type) return false;
      const a = currentAttrs(updatedNode.attrs);
      if (a.src && img.getAttribute('src') !== a.src) img.src = a.src;
      applyStyles(updatedNode.attrs);
      return resizeView.update(updatedNode, decorations as never, innerDecorations as never);
    },
    ignoreMutation: () => true,
    destroy: () => {
      wrapper.removeEventListener('pointerdown', onPointerDown);
      wrapper.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      resizeView.destroy?.();
    },
  };
}
