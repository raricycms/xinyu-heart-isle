import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { symbolGlyph } from '@/sandbox/symbols';
import { glyphFor, imageFor, imageReady, loadImage } from '@/sandbox/render/symbolSource';
import { createHeightField, sampleHeight, SURFACE_COLS, SURFACE_ROWS } from '@/sandbox/surfaceCodec';
import type { SandRendererProps } from '@/sandbox/render/types';

/**
 * three.js 正交渲染器（可选，动态加载）。
 *
 * 为什么用正交相机而不是透视：
 * 沙盘是一个有限矩形托盘，透视会给不同位置带来不同的透视缩短，
 * 让"这个摆件离我近"这类空间感受失真。正交投影保持位置可比较。
 *
 * 为什么用 Sprite：
 * 300+ 沙具用 emoji 呈现，逐摆件生成 canvas 纹理并缓存，
 * 相同 symbolId 复用同一张纹理（`TEXTURE_CACHE` 以 symbolId 为键），
 * 避免每次拖拽都重新栅格化。
 *
 * 体积：本文件只在用户选择 3D 时才被下载（见 render/index.tsx 的 lazy）。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ 能力边界：**3D 视图不支持在沙面上拖动绘制**。
 *
 * 原因不是偷懒，而是投入产出比：
 * 1. 沙面笔刷需要"指针位置 -> 沙面 UV"的反投影 + 沿视线的高度射线求交，
 *    在正交相机下还要处理托盘边缘的裁切，实现量远超本渲染器的其他部分；
 * 2. three 是动态加载的实验渲染器（~134KB gzip），把笔刷做成 3D 独占能力，
 *    等于让每个用笔刷的人都先付出这 134KB；
 * 3. 2.5D 轴测（iso2d）已经能表达起伏与纵深，且是默认渲染器。
 *
 * 因此这里选择**产品级降级**而不是半成品：
 * - page 侧把 `brush` prop 传进来时，本组件顶部显示一条 `three-renderer__nofly`
 *   提示（「3D 视角不支持拖动画沙，切到「立体沙盘」即可」，见下方 UI）；
 * - `onSurfaceStroke` 永不被调用，`onItemDrag/onItemCommit` 也不会 ——
 *   3D 里只做「点击选中摆件」，避免出现"拖了半天没反应"的错觉；
 * - 若宿主仍给了笔刷光标，不渲染它（3D 的位置语义与 2D 归一化坐标不对应）。
 *
 * 另一条硬边界：**WebGL 上下文丢失不能白屏**。
 * 移动端切后台、显存紧张、驱动崩溃都会触发 `webglcontextlost`。
 * 这里监听该事件，`preventDefault()` 争取恢复，同时立刻切换到
 * 「立体沙盘」风格的静态降级视图（不是空白画布），
 * `webglcontextrestored` 时再恢复渲染。
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TRAY_SIZE = 10;
const TRAY_DEPTH = 6;
const TRAY_THICKNESS = 0.32;
/**
 * 纹理缓存：**键是 symbolId**（不是 item.id）。
 * 同一种沙具摆 20 个只栅格化一次；上限 512 是因为沙具库最多 300+ 种，
 * 撞到上限说明有自定义沙具包，此时淘汰最早的一张防止无限增长。
 */
const TEXTURE_CACHE = new Map<string, THREE.CanvasTexture>();
const TEXTURE_CACHE_LIMIT = 512;

export function ThreeRenderer({
  items,
  surface,
  readOnly,
  selectedId,
  brush,
  imageMap,
  onSelect,
  onCanvasClick,
}: SandRendererProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  /**
   * WebGL 上下文状态：
   * `lost` = 上下文丢失（切后台 / 显存不足 / 驱动崩溃），此时画布已经不可用，
   * 必须换成静态降级视图，绝不能留一块白屏。
   */
  const [contextLost, setContextLost] = useState(false);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    group: THREE.Group;
    trayMesh: THREE.Mesh;
    resizeObserver: ResizeObserver;
    dispose: () => void;
  } | null>(null);

  /* ------------------------------- 初始化一次 ------------------------------- */

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2efe8);

    const width = Math.max(320, mount.clientWidth);
    const height = Math.max(240, mount.clientHeight);
    const aspect = width / height;
    const frustum = 8.4;
    const camera = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2,
      (frustum * aspect) / 2,
      frustum / 2,
      -frustum / 2,
      0.1,
      100,
    );
    camera.position.set(0, 11, 9);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    /*
     * 上下文丢失处理（CONTRACT §5「不能白屏」）。
     * - `preventDefault()` 是恢复的前提：不调用的话浏览器不会再发 restored。
     * - 同时 setContextLost(true) 让 React 渲染静态降级视图，
     *   用户看到的是"3D 暂停了 + 一句话"，而不是一块黑/白画布。
     * - 恢复后把状态拨回来，下一次 surface/items 变化会自然重绘。
     */
    const canvasEl = renderer.domElement;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
      resize();
      renderer.render(scene, camera);
    };
    canvasEl.addEventListener('webglcontextlost', handleContextLost, false);
    canvasEl.addEventListener('webglcontextrestored', handleContextRestored, false);

    scene.add(new THREE.AmbientLight(0xfff6e8, 1.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(-4, 9, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd8e8, 0.6);
    rim.position.set(5, 4, -6);
    scene.add(rim);

    // 托盘
    const trayGeometry = new THREE.BoxGeometry(TRAY_SIZE, TRAY_THICKNESS, TRAY_DEPTH);
    const trayMaterial = new THREE.MeshStandardMaterial({ color: 0xcdb694, roughness: 0.95 });
    const trayMesh = new THREE.Mesh(trayGeometry, trayMaterial);
    trayMesh.position.y = -TRAY_THICKNESS / 2;
    scene.add(trayMesh);

    const group = new THREE.Group();
    scene.add(group);

    const resize = () => {
      const w = Math.max(320, mount.clientWidth);
      const h = Math.max(240, mount.clientHeight);
      const nextAspect = w / h;
      camera.left = (-frustum * nextAspect) / 2;
      camera.right = (frustum * nextAspect) / 2;
      camera.top = frustum / 2;
      camera.bottom = -frustum / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    let frame = 0;
    // 只在需要时渲染（没有动画循环 -> 省电）
    const renderOnce = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderer.render(scene, camera);
      });
    };
    renderOnce();

    stateRef.current = {
      renderer,
      scene,
      camera,
      group,
      trayMesh,
      resizeObserver,
      dispose: () => {
        resizeObserver.disconnect();
        canvasEl.removeEventListener('webglcontextlost', handleContextLost, false);
        canvasEl.removeEventListener('webglcontextrestored', handleContextRestored, false);
        trayGeometry.dispose();
        trayMaterial.dispose();
        renderer.dispose();
        if (renderer.domElement.parentElement === mount) {
          mount.removeChild(renderer.domElement);
        }
      },
    };

    return () => {
      stateRef.current?.dispose();
      stateRef.current = null;
    };
  }, []);

  /* ------------------------------ 沙面 -> 网格 ------------------------------ */

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;

    // 每次沙面变化重建高度网格（16×12 顶点足够看出起伏）
    const cols = 16;
    const rows = 12;
    const geometry = new THREE.PlaneGeometry(TRAY_SIZE * 0.98, TRAY_DEPTH * 0.98, cols - 1, rows - 1);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const field = surface.height ?? createHeightField(SURFACE_COLS, SURFACE_ROWS);

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const u = col / (cols - 1);
        const v = row / (rows - 1);
        const height = sampleHeight(field, u, v);
        // 0..255 -> 0..0.55
        position.setZ(index, ((height - 90) / 255) * 0.55);
      }
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xdcc7a4,
      roughness: 0.92,
      metalness: 0,
      flatShading: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.005;
    state.scene.add(mesh);

    return () => {
      state.scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    };
  }, [surface]);

  /* ------------------------------ 摆件 -> Sprite ---------------------------- */

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;

    // 清空旧摆件（保留托盘与沙面网格）
    for (const child of [...state.group.children]) {
      state.group.remove(child);
      const sprite = child as THREE.Sprite;
      if (sprite.material) {
        const material = sprite.material as THREE.SpriteMaterial;
        if (material.map && !TEXTURE_CACHE.has('keep')) {
          // 纹理走全局缓存，这里不 dispose
        }
        material.dispose();
      }
    }

    const field = surface.height ?? createHeightField(SURFACE_COLS, SURFACE_ROWS);

    for (const item of items) {
      const texture = glyphTexture(item.symbolId, imageMap);
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      const size = 0.55 + item.scale * 0.4;

      const height = sampleHeight(field, item.x, item.y);
      const lift = ((height - 90) / 255) * 0.55;
      const burial = item.burial ?? 0;

      sprite.position.set(
        (item.x - 0.5) * TRAY_SIZE,
        lift + size * 0.42 - burial * 0.24,
        (item.y - 0.5) * TRAY_DEPTH,
      );
      sprite.scale.set(size, size, 1);
      sprite.material.rotation = (item.rotation * Math.PI) / 180;
      sprite.userData.itemId = item.id;
      sprite.userData.highlighted = item.id === selectedId;

      state.group.add(sprite);
    }

    // 触发一次重绘
    state.renderer.render(state.scene, state.camera);
  }, [items, selectedId, surface, imageMap]);

  /* --------------------------------- 交互 --------------------------------- */

  const pick = (clientX: number, clientY: number): string | null => {
    const state = stateRef.current;
    const mount = mountRef.current;
    if (!state || !mount) return null;
    const rect = mount.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), state.camera);
    const hits = raycaster.intersectObjects(state.group.children, false);
    for (const hit of hits) {
      const id = hit.object.userData.itemId;
      if (typeof id === 'string') return id;
    }
    return null;
  };

  const handleClick = (event: React.MouseEvent) => {
    if (readOnly) return;
    const id = pick(event.clientX, event.clientY);
    onSelect(id);
    if (!id) onCanvasClick?.();
  };

  /*
   * 渲染分支：
   * 1. 上下文丢失 -> 静态降级（把当前摆件画成 emoji 列表，位置按归一化坐标摆），
   *    信息不丢，也不白屏；
   * 2. 正常 -> WebGL 挂载点 + 顶部提示。
   */
  return (
    <div
      className={`three-renderer${brush ? ' three-renderer--nobrush' : ''}${contextLost ? ' three-renderer--lost' : ''}`}
      ref={mountRef}
      onClick={handleClick}
      role="application"
      aria-label="3D 沙盘视图，点击摆件选中；3D 视图不支持拖动画沙。"
    >
      {/*
        能力边界提示：page 把 brush 传进来（用户选了笔刷）时就说明"这里画不了"，
        并且直接告诉他去哪儿画。这是**降级方案**，不是报错 —— 3D 沙盘本身可用。
      */}
      {brush ? (
        <p className="three-renderer__hint three-renderer__nofly" role="status">
          <span aria-hidden="true">✎</span> 3D 视角不支持拖动画沙。切到「立体沙盘」就能画，摆件在这里一样能选中。
        </p>
      ) : (
        <p className="three-renderer__hint small">
          3D 视图为实验功能。看不到画面时会自动回退到「立体沙盘」。
        </p>
      )}

      {contextLost ? (
        <div className="three-renderer__fallback" role="status" aria-live="polite">
          <p className="three-renderer__fallback-title">3D 画面暂时中断</p>
          <p className="small muted">
            显卡上下文被系统回收了（常见于切到后台或内存紧张）。内容没有丢失，切回「立体沙盘」可以继续。
          </p>
          {/* 用 emoji 列表保留信息：这些摆件是真的在数据里的，不是占位 */}
          <ul className="three-renderer__fallback-list" aria-label="摆件清单">
            {items.map((item) => (
              <li key={item.id}>
                <span aria-hidden="true">{symbolGlyph(item.symbolId)}</span>
                <span className="small">{item.note ?? '未写注释'}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 沙具 -> 纹理。
 *
 * 缓存键：字形沙具用 `symbolId`，图片沙具用 `img:<dataUrl前 64 字符>`。
 * 为什么图片要换键：`symbolId` 并不唯一决定外观 —— 用户导入同名 id 的
 * 新沙具包后，旧纹理会被错误复用。图片内容变了就必须换键。
 *
 * 图片尚未解码完成时**返回字形纹理**（而不是空纹理），首帧不至于缺块；
 * 等 `onReady` 触发重绘后自然换成图片。
 */
function glyphTexture(
  symbolId: string,
  imageMap?: Record<string, string>,
  onReady?: () => void,
): THREE.CanvasTexture {
  const dataUrl = imageFor(symbolId, imageMap);
  const cacheKey = dataUrl ? `img:${dataUrl.slice(0, 64)}:${dataUrl.length}` : `glyph:${symbolId}`;
  const cached = TEXTURE_CACHE.get(cacheKey);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  let paintedSource = `glyph:${symbolId}`;
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
  }

  // 优先画图片
  if (ctx && dataUrl) {
    const image = loadImage(dataUrl, () => {
      // 解码完成后：丢掉字形兜底纹理的缓存，让下次调用真的去画图片
      TEXTURE_CACHE.delete(cacheKey);
      onReady?.();
    });
    if (imageReady(image)) {
      // 等比铺满，留 6% 内边距避免切边
      const pad = size * 0.06;
      const box = size - pad * 2;
      const ratio = image.naturalWidth / image.naturalHeight;
      const drawW = ratio >= 1 ? box : box * ratio;
      const drawH = ratio >= 1 ? box / ratio : box;
      ctx.drawImage(image, (size - drawW) / 2, (size - drawH) / 2, drawW, drawH);
      paintedSource = cacheKey;
    }
  }

  // 图片没画上（没提供 / 还没解码完）：画字形兜底
  if (ctx && paintedSource !== cacheKey) {
    ctx.font = `${size * 0.78}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 用与 2D 渲染器完全一致的 glyph，保证切换渲染器时摆件外观一致
    ctx.fillText(glyphFor(symbolId), size / 2, size * 0.56);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  // 上限保护：自定义沙具包可能让 symbolId 无限增长，淘汰最早的一张。
  // 注意只 dispose GPU 侧纹理，canvas 由 GC 回收。
  if (TEXTURE_CACHE.size >= TEXTURE_CACHE_LIMIT) {
    const oldestKey = TEXTURE_CACHE.keys().next().value;
    if (typeof oldestKey === 'string') {
      TEXTURE_CACHE.get(oldestKey)?.dispose();
      TEXTURE_CACHE.delete(oldestKey);
    }
  }

  // 图片未就绪时用字形键缓存（避免每帧重建 canvas）；
  // 就绪后 onReady 会把这个键删掉。
  TEXTURE_CACHE.set(paintedSource === cacheKey ? cacheKey : `glyph:${symbolId}`, texture);
  return texture;
}

export default ThreeRenderer;
