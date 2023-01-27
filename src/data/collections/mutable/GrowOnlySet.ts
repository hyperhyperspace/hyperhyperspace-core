import { MultiMap } from 'util/multimap';

import { Identity } from '../../identity';
import { Hash, HashedObject, MutationOp, MutableContentEvents, ClassRegistry, Literal } from '../../model';
import { BaseCollection, CollectionConfig, CollectionOp } from './Collection';

type ElmtHash = Hash;

enum GrowOnlySetEvents {
    Add = 'add'
}

class AddOp<T> extends CollectionOp<T> {

    static className = 'hhs/v0/GrowOnlySet/AddOp';

    element?: T;

    constructor(targetObject?: GrowOnlySet<T>, element?: T, author?: Identity) {
        super(targetObject);

        this.element = element;
        
        if (author !== undefined) {
            this.setAuthor(author);
        }
    }

    getClassName(): string {
        return AddOp.className;
    }

    init(): void {
        
    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }

        const targetObject = this.getTargetObject();

        if (! (targetObject instanceof GrowOnlySet)) {
            return false;
        }

        const author = this.getAuthor();

        if (targetObject.writers !== undefined && (author===undefined || !targetObject.writers.has(author))) {
            return false;
        }

        if (!(this.element instanceof HashedObject || HashedObject.isLiteral(this.element))) {
            return false;
        }

        return true;
    }
    
}

class GrowOnlySet<T> extends BaseCollection<T> {
  static className = "hhs/v0/GrowOnlySet";

  _elements: Map<ElmtHash, T>;

  constructor(config?: CollectionConfig) {
    super([AddOp.className], config);

    this.setRandomId();

    this._elements = new Map();
  }

  init(): void {}

  exportMutableState() {
    return [...this._elements.entries()].map(([hash, elmt]) => [
      hash,
      elmt instanceof HashedObject ? elmt.toLiteral() : elmt,
    ]);
  }

  importMutableState(state: any): void {
    this._elements = new Map(
      state.map(([hash, elmt]: [Hash, Object]) => [
        hash,
        HashedObject.isLiteral(elmt) ? HashedObject.fromLiteral(elmt as Literal) : elmt,
      ])
    );
  }

  async add(element: T, author?: Identity) {
    if (!(element instanceof HashedObject)) {
      if (!HashedObject.isLiteral(element)) {
        throw new Error(
          "GrowOnlySets can contain either a class deriving from HashedObject or a pure literal (a constant, without any HashedObjects within)."
        );
      }
    }

    if (!this.has(element)) {
      let op = new AddOp<T>(this, element, author);
      if (author !== undefined) {
        if (this.writers !== undefined && !this.writers.has(author)) {
          throw new Error(
            "Identity " +
              author.hash() +
              " tried to add an element to GrowOnlySet " +
              this.hash() +
              ", but it is not in the writers set."
          );
        }
      } else {
        if (this.writers !== undefined) {
          throw new Error(
            "Tried to add an element to GrowOnlySet " +
              this.hash +
              ", but did not probide an author that can write to it."
          );
        }
      }
      return this.applyNewOp(op);
    }
  }

  has(element: T) {
    return this.hasByHash(HashedObject.hashElement(element));
  }

  hasByHash(hash: Hash) {
    return this._elements.has(hash);
  }

  size() {
    return this._elements.size;
  }

  mutate(op: MutationOp): Promise<boolean> {
    const elmt = (op as AddOp<T>).element as T;
    const elmtHash = HashedObject.hashElement(elmt);

    let mutated = !this._elements.has(elmtHash);

    if (mutated) {
      this._elements.set(elmtHash, elmt);

      if (elmt instanceof HashedObject) {
        this._mutationEventSource?.emit({
          emitter: this,
          action: MutableContentEvents.AddObject,
          data: elmt,
        });
      }

      this._mutationEventSource?.emit({
        emitter: this,
        action: GrowOnlySetEvents.Add,
        data: elmt,
      });
    }

    return Promise.resolve(mutated);
  }

  async validate(references: Map<string, HashedObject>) {
    return super.validate(references);
  }

  getMutableContents(): MultiMap<string, HashedObject> {
    const contents = new MultiMap<Hash, HashedObject>();

    for (const [hash, elmt] of this._elements) {
      if (elmt instanceof HashedObject) {
        contents.add(hash, elmt);
      }
    }

    return contents;
  }

  getMutableContentByHash(hash: string): Set<HashedObject> {
    const found = new Set<HashedObject>();

    const elmt = this._elements.get(hash);

    if (elmt instanceof HashedObject) {
      found.add(elmt);
    }

    return found;
  }

  shouldAcceptMutationOp(
    op: MutationOp,
    opReferences: Map<Hash, HashedObject>
  ): boolean {
    if (!super.shouldAcceptMutationOp(op, opReferences)) {
      return false;
    }

    if (op instanceof AddOp && !this.shouldAcceptElement(op.element as T)) {
      return false;
    }

    return true;
  }

  getClassName(): string {
    return GrowOnlySet.className;
  }
}

ClassRegistry.register(AddOp.className, AddOp);
ClassRegistry.register(GrowOnlySet.className, GrowOnlySet);

export { GrowOnlySet, GrowOnlySetEvents, AddOp as GrowOnlySetAddOp };