

class Lock {

    inUse: boolean;

    constructor() {
        this.inUse = false;
    }

    acquire(): boolean {
        const success = !this.inUse;
        this.inUse = true;
        return success;
    }

    release(): boolean {
        const success = this.inUse;
        this.inUse = false;
        return success;
    }

}

export { Lock };