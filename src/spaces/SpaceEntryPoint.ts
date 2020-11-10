interface SpaceEntryPoint {
    startSync(): Promise<void>;
    stopSync(): Promise<void>;
}

export { SpaceEntryPoint }