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
        return true;
    }

    static valid(value: any, seen=new Set()) : boolean {

        let typ = typeof(value);

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            return true;
        } else if (typ === 'object') {

            if (seen.has(value)) {
                return false;
            }

            seen.add(value);

            if (Array.isArray(value)) {

                for (const member of value) {
                    if (!HashedLiteral.valid(member, seen)) {
                        return false;
                    }
                }

                return true;

            } else  {
                let s = Object.prototype.toString.call(value);
                
                if (s !== '[object Object]') {
                    return false;
                }

                for (const fieldName of Object.keys(value)) {
                    if (!HashedLiteral.valid(value[fieldName], seen)) {
                        return false;
                    }
                }

                return true;
            }
        } else {
            return false;
        }

    }

}

HashedObject.registerClass(HashedLiteral.className, HashedLiteral);

export { HashedLiteral }