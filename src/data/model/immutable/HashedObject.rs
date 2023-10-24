use std::collections::{HashMap, HashSet};
use crate::storage::store::Store;
use crate::crypto::random::RNGImpl;
use crate::identity::Identity;
use crate::hashing::{Hashing, Hash};
use crate::serialization::Serialization;
use crate::immutable::{HashedSet, HashReference, HashedMap};
use crate::literals::{Context, LiteralContext};
use crate::mesh::service::Mesh;
use crate::spaces::spaces::Resources;
use crate::literals::literal_utils::{Literal, Dependency};
use crate::util::logging::{Logger, LogLevel};
use crate::literals::class_registry::ClassRegistry;
use crate::util::events::EventRelay;
use crate::mutable::MutationObserver;

const BITS_FOR_ID: u32 = 128;

pub trait HashedObject {
    fn get_class_name(&self) -> String;
    fn init(&mut self);
    async fn validate(&self, references: &HashMap<Hash, Box<dyn HashedObject>>) -> bool;
    fn get_id(&self) -> Option<String>;
    fn set_id(&mut self, id: String);
    fn set_random_id(&mut self);
    fn has_id(&self) -> bool;
    fn set_author(&mut self, author: Identity);
    fn get_author(&self) -> Option<&Identity>;
    fn has_author(&self) -> bool;
    fn has_last_signature(&self) -> bool;
    fn set_last_signature(&mut self, signature: String);
    fn get_last_signature(&self) -> String;
    fn override_children_id(&mut self);
    fn override_id_for_path(&mut self, path: String, target: &mut dyn HashedObject);
    fn has_store(&self) -> bool;
    fn set_store(&mut self, store: Store);
    fn get_store(&self) -> Store;
    fn get_mesh(&self) -> Mesh;
    fn has_last_literal(&self) -> bool;
    fn get_last_literal(&self) -> Option<&Literal>;
    fn set_last_literal(&mut self, literal: Literal);
    fn should_sign_on_save(&self) -> bool;
    fn has_last_hash(&self) -> bool;
    fn get_last_hash(&self) -> Hash;
    fn hash(&mut self, seed: Option<String>) -> Hash;
    fn custom_hash(&self, seed: Option<String>) -> Option<Hash>;
    fn create_reference(&self) -> HashReference<Self>
    where
        Self: Sized;
    fn equals(&self, another: Option<&dyn HashedObject>) -> bool;
    fn clone(&self) -> Box<dyn HashedObject>;
    fn add_derived_field(&mut self, field_name: String, object: Option<Box<dyn HashedObject>>);
    fn set_derived_field(&mut self, field_name: String, object: Box<dyn HashedObject>);
    fn check_derived_field(&self, field_name: &str) -> bool;
    fn get_derived_field_id(&self, field_name: &str) -> Hash;
    fn set_resources(&mut self, resources: Resources);
}
