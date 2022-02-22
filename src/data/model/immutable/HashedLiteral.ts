import { HashedObject } from './HashedObject';


class HashedLiteral extends HashedObject {

    static className = 'hhs/v0/HashedLiteral';

    value?: any;

    constructor(value?: any) {
        super();

        this.value = value;
    }

    getClassName(): string {
        return HashedLiteral.className;
    }

    init(): void {

    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        references;
        return HashedObject.isLiteral(this.value);
    }

}

HashedObject.registerClass(HashedLiteral.className, HashedLiteral);

export { HashedLiteral }