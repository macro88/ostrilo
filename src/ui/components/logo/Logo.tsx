import React from 'react';
import SceneSetup from './ModelViewer';
import ostrilohead from '@/assets/ostrilo.glb';

interface LogoProps {
    className?: string;
    size?: 'sm' | 'md' | 'lg' | 'max';
}

const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
    max: 'h-full w-full',
};

const DEFAULT_CONFIG = {
    scale: 4.1,
    cameraZ: 7,
    fov: 42,
    ambientIntensity: 2.6,
    keyLightIntensity: 2.4,
    maxRotationDeg: 29,
    smoothness: 0.1,
    mirror: true,
    autoCenter: false,
    positionX: 0,
    positionY: -1.8,
    positionZ: 0,
    rotationX: -65,
    rotationY: 0,
    rotationZ: 0,
  };


export const Logo: React.FC<LogoProps> = ({ className = '', size = 'md' }) => {
    return (
        <div className={`${sizeClasses[size]} ${className}`}>
            <SceneSetup fileUrl={ostrilohead} textureUrl={undefined} config={DEFAULT_CONFIG} />
        </div>
    );
};