import { MutableReference } from 'data/collections';

interface SpaceEntryPoint {
    
    getName(): MutableReference<string>|string|undefined;
    getVersion(): string;

    startSync(): Promise<void>;
    stopSync(): Promise<void>;
    
}

export { SpaceEntryPoint }