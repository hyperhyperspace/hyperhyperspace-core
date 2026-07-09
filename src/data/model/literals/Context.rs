use std::collections::{HashMap, HashSet};
use crate::hashed_object::HashedObject;
use crate::hashing::{Hash, Literal};
use crate::spaces::Resources;

pub type LiteralContext = (Vec<Hash>, HashMap<Hash, Literal>);

pub fn is_literal_context(obj: &dyn Any) -> bool {
    obj.downcast_ref::<LiteralContext>().is_some()
}

pub struct Context {
    pub root_hashes: Vec<Hash>,
    pub objects: HashMap<Hash, HashedObject>,
    pub literals: HashMap<Hash, Literal>,
    pub resources: Option<Resources>,
}

impl Context {
    pub fn new() -> Self {
        Self {
            root_hashes: Vec::new(),
            objects: HashMap::new(),
            literals: HashMap::new(),
            resources: None,
        }
    }

    pub fn has(&self, hash: &Hash) -> bool {
        self.literals.contains_key(hash)
            || self.objects.contains_key(hash)
            || self
                .resources
                .as_ref()
                .map(|r| r.aliasing.as_ref().map(|a| a.contains_key(hash)).unwrap_or(false))
                .unwrap_or(false)
    }

    pub fn to_literal_context(&self) -> LiteralContext {
        (
            self.root_hashes.clone(),
            self.literals.clone(),
        )
    }

    pub fn from_literal_context(&mut self, literal_context: LiteralContext) {
        self.root_hashes = literal_context.0;
        self.literals = literal_context.1;
        self.objects = HashMap::new();
    }

    pub fn merge(&mut self, other: &Context) {
        let roots: HashSet<Hash> = self
            .root_hashes
            .iter()
            .chain(other.root_hashes.iter())
            .cloned()
            .collect();
        self.root_hashes = roots.into_iter().collect();

        for (hash, literal) in &other.literals {
            self.literals.entry(*hash).or_insert_with(|| literal.clone());
        }

        for (hash, obj) in &other.objects {
            self.objects.entry(*hash).or_insert_with(|| obj.clone());
        }

        if let Some(ref mut resources) = self.resources {
            if let Some(ref other_aliasing) = other.resources.as_ref().and_then(|r| r.aliasing.as_ref()) {
                if resources.aliasing.is_none() {
                    resources.aliasing = Some(HashMap::new());
                }
                let aliasing = resources.aliasing.as_mut().unwrap();
                for (hash, aliased) in other_aliasing {
                    aliasing.entry(*hash).or_insert_with(|| aliased.clone());
                }
            }
        } else {
            self.resources = other.resources.clone();
        }
    }

    pub fn copy(&self) -> Context {
        let mut another = Context::new();
        another.merge(self);
        another
    }

    // if a dependency is in more than one subobject, it will pick one of the shortest dep chains.
    pub fn find_missing_deps(&self, hash: &Hash, chain: Option<Vec<Hash>>, missing: Option<HashMap<Hash, Vec<Hash>>>) -> HashMap<Hash, Vec<Hash>> {
        let mut chain = chain.unwrap_or_default();
        let mut missing = missing.unwrap_or_default();

        if let Some(literal) = self.literals.get(hash) {
            for dep in &literal.dependencies {
                let mut new_chain = chain.clone();
                new_chain.insert(0, *hash);
                let new_missing = self.find_missing_deps(dep.hash, Some(new_chain), Some(missing));
                missing = missing.into_iter().chain(new_missing).collect();
            }
        } else {
            let prev_chain = missing.get(hash);
            if prev_chain.is_none() || chain.len() < prev_chain.unwrap().len() {
                missing.insert(*hash, chain);
            }
        }

        missing
    }

    pub fn check_literal_hashes(&self) -> bool {
        self.literals.iter().all(|(hash, literal)| {
            hash == &literal.hash && literal.validate_hash()
        })
    }

    pub fn check_root_hashes(&self) -> bool {
        self.root_hashes.iter().all(|hash| self.literals.contains_key(hash))
    }
}
