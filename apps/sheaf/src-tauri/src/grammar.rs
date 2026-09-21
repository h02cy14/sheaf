//! English spelling and grammar, offline, via Harper (Apache-2.0).
//!
//! Why here and not in the frontend: the brief (§7) asks for checking that
//! never blocks typing and never touches the network. Harper is a Rust
//! library, so it runs on a background thread through `spawn_blocking`, and
//! the WebView's content security policy keeps it that way — nothing about
//! checking a paragraph can leave the device.
//!
//! Chinese never reaches this file. The decision is made before the call, in
//! `@sheaf/core`'s language policy, so that "no checking for Chinese" is one
//! rule in one place rather than a behaviour that varies by platform.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use harper_core::linting::{LintGroup, Linter, Suggestion};
use harper_core::spell::{FstDictionary, MergedDictionary, MutableDictionary};
use harper_core::{Dialect, DictWordMetadata, Document};
use serde::Serialize;

use crate::error::{CmdError, CmdResult};

/// One problem Harper found, in offsets the editor can use directly.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GrammarLint {
    /// UTF-16 offsets into the text that was checked, as JavaScript counts.
    pub start: usize,
    pub end: usize,
    pub kind: String,
    pub message: String,
    /// Replacements for `start..end`, best first. May be empty.
    pub suggestions: Vec<String>,
}

fn dialect_from(name: &str) -> Dialect {
    match name {
        "british" => Dialect::British,
        "canadian" => Dialect::Canadian,
        "australian" => Dialect::Australian,
        _ => Dialect::American,
    }
}

/// The curated dictionary is a few megabytes to build, so build it once.
fn curated() -> &'static Arc<FstDictionary> {
    static CURATED: OnceLock<Arc<FstDictionary>> = OnceLock::new();
    CURATED.get_or_init(FstDictionary::curated)
}

/// The curated dictionary plus whatever words the writer added to this
/// project. Always merged, so one concrete type serves both cases.
fn with_user_words(words: &[String]) -> Arc<MergedDictionary> {
    let mut merged = MergedDictionary::new();
    merged.add_dictionary(curated().clone());
    if !words.is_empty() {
        let mut extra = MutableDictionary::new();
        for word in words {
            extra.append_word_str(word, DictWordMetadata::default());
        }
        merged.add_dictionary(Arc::new(extra));
    }
    Arc::new(merged)
}

type GroupCache = Mutex<HashMap<(String, u64), LintGroup>>;

/// Lint groups are stateful (they cache), so keep one per dialect and per set
/// of user words rather than rebuilding on every keystroke pause.
fn groups() -> &'static GroupCache {
    static GROUPS: OnceLock<GroupCache> = OnceLock::new();
    GROUPS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn words_key(words: &[String]) -> u64 {
    use std::hash::{DefaultHasher, Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    words.hash(&mut hasher);
    hasher.finish()
}

/// Checks one piece of English text. `text` is plain text, not Markdown: the
/// editor sends what the reader sees, so offsets map straight back to it.
pub fn check(text: &str, dialect: &str, user_words: &[String]) -> CmdResult<Vec<GrammarLint>> {
    let key = (dialect.to_string(), words_key(user_words));
    let mut cache = groups()
        .lock()
        .map_err(|_| CmdError::new("internal", "The grammar cache lock was poisoned."))?;
    let group = cache.entry(key).or_insert_with(|| {
        LintGroup::new_curated(with_user_words(user_words), dialect_from(dialect))
    });

    let chars: Vec<char> = text.chars().collect();
    let document = Document::new_plain_english(text, &with_user_words(user_words));
    let mut lints = group.lint(&document);
    harper_core::remove_overlaps(&mut lints);

    // Harper counts in characters; JavaScript counts in UTF-16 code units.
    // Build one running table instead of re-scanning per lint.
    let mut utf16_at: Vec<usize> = Vec::with_capacity(chars.len() + 1);
    let mut units = 0usize;
    for ch in &chars {
        utf16_at.push(units);
        units += ch.len_utf16();
    }
    utf16_at.push(units);
    let at = |index: usize| *utf16_at.get(index).unwrap_or(&units);

    Ok(lints
        .into_iter()
        .map(|lint| {
            let span_text: String = chars
                .get(lint.span.start..lint.span.end)
                .unwrap_or_default()
                .iter()
                .collect();
            let suggestions = lint
                .suggestions
                .iter()
                .map(|suggestion| match suggestion {
                    Suggestion::ReplaceWith(replacement) => replacement.iter().collect(),
                    Suggestion::Remove => String::new(),
                    Suggestion::InsertAfter(addition) => {
                        format!("{span_text}{}", addition.iter().collect::<String>())
                    }
                })
                .collect();
            GrammarLint {
                start: at(lint.span.start),
                end: at(lint.span.end),
                kind: format!("{:?}", lint.lint_kind).to_lowercase(),
                message: lint.message,
                suggestions,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_repeated_word_and_suggests_the_fix() {
        let lints = check("The keeper counted the the waves.", "american", &[]).unwrap();
        let repeated = lints
            .iter()
            .find(|l| l.message.to_lowercase().contains("repeat"))
            .expect("the repeated word should be found");
        assert_eq!(
            &"The keeper counted the the waves."[repeated.start..repeated.end],
            "the the"
        );
        assert!(repeated.suggestions.iter().any(|s| s == "the"));
    }

    #[test]
    fn leaves_correct_english_alone() {
        let lints = check(
            "The keeper counted the waves until morning came.",
            "american",
            &[],
        )
        .unwrap();
        assert_eq!(lints, vec![]);
    }

    #[test]
    fn a_word_from_the_project_dictionary_is_not_a_mistake() {
        let invented = "Thessaly stood on the quay and watched the mirelight fade.";
        let flags_it = |lints: &[GrammarLint]| {
            lints
                .iter()
                .any(|l| &invented[l.start..l.end] == "mirelight")
        };
        let without = check(invented, "american", &[]).unwrap();
        assert!(
            flags_it(&without),
            "expected the invented word to be flagged, got {without:?}"
        );

        let with = check(invented, "american", &["mirelight".to_string()]).unwrap();
        assert!(
            !flags_it(&with),
            "the project's own word should be accepted, got {with:?}"
        );
    }

    #[test]
    fn offsets_are_utf16_so_they_land_in_the_right_place() {
        // The emoji is two UTF-16 units; the lint after it must still line up.
        let text = "A 🌊 and and the sea.";
        let lints = check(text, "american", &[]).unwrap();
        let utf16: Vec<u16> = text.encode_utf16().collect();
        let repeated = lints
            .iter()
            .find(|l| l.message.to_lowercase().contains("repeat"))
            .expect("the repeated word should be found");
        let slice = String::from_utf16(&utf16[repeated.start..repeated.end]).unwrap();
        assert_eq!(slice, "and and");
    }
}
