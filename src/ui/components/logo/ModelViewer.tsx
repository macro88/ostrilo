import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

interface ViewerConfig {
  scale: number;
  cameraZ: number;
  fov: number;
  ambientIntensity: number;
  keyLightIntensity: number;
  maxRotationDeg: number;
  smoothness: number;
  mirror: boolean;
  autoCenter: boolean;
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
}

interface SceneSetupProps {
  fileUrl: string | null;
  textureUrl?: string | null;
  config: ViewerConfig;
  posterUrl?: string;
}

class OstrichViewer {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  
  // Scene Graph
  rootGroup: THREE.Group; // Holds position/rotation offsets
  pivotGroup: THREE.Group; // The rotating head rig
  modelGroup: THREE.Group; // The actual loaded model (and mirror)
  
  // Lights
  ambientLight: THREE.AmbientLight;
  keyLight: THREE.DirectionalLight;
  fillLight: THREE.DirectionalLight;
  backLight: THREE.DirectionalLight;

  // State
  mouse: THREE.Vector2;
  targetRotation: THREE.Vector2;
  currentRotation: THREE.Vector2;
  modelBounds: { center: THREE.Vector3; scale: number };
  animationFrameId: number;
  config: ViewerConfig;
  reduceMotion: boolean;
  
  // Cleanup
  resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, config: ViewerConfig) {
    this.container = container;
    this.config = config;
    this.mouse = new THREE.Vector2(0, 0);
    this.targetRotation = new THREE.Vector2(0, 0);
    this.currentRotation = new THREE.Vector2(0, 0);
    this.modelBounds = { center: new THREE.Vector3(), scale: 1 };
    this.animationFrameId = 0;
    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 1. Setup Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // 2. Setup Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(config.fov, container.clientWidth / container.clientHeight, 0.1, 1000);
    this.camera.position.z = config.cameraZ;

    // 3. Scene Graph Hierarchy
    // rootGroup: handles Position Offset (X,Y,Z)
    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    // pivotGroup: handles Tracking Rotation (lerping mouse movement)
    this.pivotGroup = new THREE.Group();
    this.rootGroup.add(this.pivotGroup);

    // modelGroup: handles User Rotation Offset (sliders) + Mirroring
    this.modelGroup = new THREE.Group();
    this.pivotGroup.add(this.modelGroup);

    // 4. Lights
    this.ambientLight = new THREE.AmbientLight(0xffffff, config.ambientIntensity);
    this.scene.add(this.ambientLight);

    this.keyLight = new THREE.DirectionalLight(0xffffff, config.keyLightIntensity);
    this.keyLight.position.set(5, 5, 5);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 1024;
    this.keyLight.shadow.mapSize.height = 1024;
    this.keyLight.shadow.bias = -0.0001;
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0xa5b4fc, config.keyLightIntensity * 0.5);
    this.fillLight.position.set(-5, 0, 5);
    this.scene.add(this.fillLight);

    this.backLight = new THREE.DirectionalLight(0xe0e7ff, config.keyLightIntensity * 0.75);
    this.backLight.position.set(0, 5, -5);
    this.scene.add(this.backLight);

    // 5. Events
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    if (!this.reduceMotion) {
      window.addEventListener('pointermove', this.onPointerMove);
    }
    
    // 6. Start Loop
    if (this.reduceMotion) {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.animate();
    }

    // Apply initial config
    this.updateConfig(config);
  }

  loadModel(url: string | null, textureUrl?: string | null) {
    // Clear previous model
    while(this.modelGroup.children.length > 0){ 
      const child = this.modelGroup.children[0];
      this.modelGroup.remove(child);
      if (child instanceof THREE.Mesh) {
         if (child.geometry) child.geometry.dispose();
      }
    }

    if (!url) return;

    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
      const scene = gltf.scene;

      // Texture logic
      if (textureUrl) {
         const texLoader = new THREE.TextureLoader();
         texLoader.load(textureUrl, (tex) => {
             tex.flipY = false;
             tex.colorSpace = THREE.SRGBColorSpace;
             scene.traverse((obj) => {
                 if (obj instanceof THREE.Mesh) {
                     const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                     mats.forEach(m => {
                         if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshBasicMaterial) {
                             m.map = tex;
                             m.needsUpdate = true;
                         }
                     });
                 }
             });
         });
      }

      // Material fixes & Shadow
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(m => {
                m.side = THREE.DoubleSide;
                if (m instanceof THREE.MeshStandardMaterial) {
                    m.roughness = Math.max(m.roughness, 0.5);
                    m.envMapIntensity = 0;
                }
            });
        }
      });

      // Calculate bounds for normalization
      const box = new THREE.Box3().setFromObject(scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);

      const maxDim = Math.max(size.x, size.y, size.z);
      this.modelBounds.scale = 1 / (maxDim || 1);
      this.modelBounds.center.copy(center).multiplyScalar(-1);

      // Add to scene
      this.modelGroup.add(scene);

      // Handle Mirror
      if (this.config.mirror) {
          const clone = scene.clone();
          clone.scale.set(-1, 1, 1); 
          this.modelGroup.add(clone);
      }
      
      this.updateModelTransform();
    });
  }

  updateConfig(config: ViewerConfig) {
    this.config = config;

    // Camera
    this.camera.fov = config.fov;
    this.camera.position.z = config.cameraZ;
    this.camera.updateProjectionMatrix();

    // Lights
    this.ambientLight.intensity = config.ambientIntensity;
    this.keyLight.intensity = config.keyLightIntensity;
    this.fillLight.intensity = config.keyLightIntensity * 0.5;
    this.backLight.intensity = config.keyLightIntensity * 0.75;

    // Position offsets
    this.rootGroup.position.set(
        config.positionX,
        config.positionY,
        config.positionZ
    );

    // Mirror Update
    if (this.modelGroup.children.length > 0) {
        const hasMirror = this.modelGroup.children.length > 1;
        if (config.mirror && !hasMirror) {
            const original = this.modelGroup.children[0];
            const clone = original.clone();
            clone.scale.set(-1, 1, 1);
            this.modelGroup.add(clone);
        } else if (!config.mirror && hasMirror) {
             while(this.modelGroup.children.length > 1) {
                 this.modelGroup.remove(this.modelGroup.children[1]);
             }
        }
    }

    this.updateModelTransform();
  }

  updateModelTransform() {
    const s = this.modelBounds.scale * this.config.scale;
    
    this.modelGroup.children.forEach((child, index) => {
         const sign = (index === 1) ? -1 : 1;
         child.scale.set(s * sign, s, s);

         if (this.config.autoCenter) {
             child.position.copy(this.modelBounds.center).multiplyScalar(s);
             child.position.x *= sign; 
         } else {
             child.position.set(0, 0, 0);
         }
    });

    const rad = Math.PI / 180;
    this.modelGroup.rotation.set(
        this.config.rotationX * rad,
        this.config.rotationY * rad,
        this.config.rotationZ * rad
    );
  }

  onPointerMove = (e: PointerEvent) => {
    // Calculate mouse position relative to viewport center
    // This makes the logo look forward when mouse is at screen center,
    // regardless of where the container is positioned
    const viewportCenterX = window.innerWidth / 3;
    const viewportCenterY = window.innerHeight / 4;
    
    const offsetX = e.clientX - viewportCenterX;
    const offsetY = e.clientY - viewportCenterY;
    
    // Normalize to -1 to 1 range based on viewport dimensions
    const nX = offsetX / (window.innerWidth / 2);
    const nY = -offsetY / (window.innerHeight / 2);

    this.mouse.set(nX, nY);
  }

  onResize() {
    if (!this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    const maxRad = (this.config.maxRotationDeg * Math.PI) / 180;
    
    // const targetY = this.mouse.x * maxRad;
    // const targetX = -this.mouse.y * maxRad;

    const targetY = THREE.MathUtils.clamp(this.mouse.x, -maxRad, maxRad);
    const targetX = THREE.MathUtils.clamp(-this.mouse.y, -maxRad, maxRad);
//console.log(targetX, targetY);
    const smooth = this.config.smoothness;
    this.currentRotation.x = THREE.MathUtils.lerp(this.currentRotation.x, targetX, smooth);
    this.currentRotation.y = THREE.MathUtils.lerp(this.currentRotation.y, targetY, smooth);

    this.pivotGroup.rotation.x = this.currentRotation.x;
    this.pivotGroup.rotation.y = this.currentRotation.y;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.resizeObserver.disconnect();
    this.container.removeChild(this.renderer.domElement);
    this.renderer.dispose();
  }
}

const SceneSetup: React.FC<SceneSetupProps> = ({
    fileUrl,
    textureUrl,
    config,
    posterUrl,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<OstrichViewer | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!containerRef.current) return;
        
        const viewer = new OstrichViewer(containerRef.current, config);
        viewerRef.current = viewer;

        return () => {
            viewer.dispose();
            viewerRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (viewerRef.current) {
            viewerRef.current.updateConfig(config);
        }
    }, [config]);

    useEffect(() => {
        if (viewerRef.current && fileUrl) {
            setIsLoading(true);
            viewerRef.current.loadModel(fileUrl, textureUrl);
        setTimeout(() => setIsLoading(false), 500);
        }
    }, [fileUrl, textureUrl]);

    return (
        <div className="group relative h-full w-full">
            {posterUrl && (
                <img
                    src={posterUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-contain"
                    aria-hidden="true"
                />
            )}
            <div
                ref={containerRef}
                className={`relative h-full w-full transition-opacity duration-150 ${
                    isLoading ? "opacity-0" : "opacity-100"
                }`}
            />
        </div>
    )
}

export default SceneSetup;
