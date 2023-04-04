use std::collections::HashMap;

pub struct WordCode {
    dict_name: String,
    words: Vec<String>,
    bits_per_word: f64,
    normalizer: Box<dyn Fn(String) -> String>,
    word_positions: Option<HashMap<String, usize>>,
}

impl WordCode {
    pub fn new(
        dict_name: String,
        words: Vec<String>,
        normalizer: Option<Box<dyn Fn(String) -> String>>,
    ) -> Self {
        let bits_per_word = (words.len() as f64).log2();
        let normalizer = normalizer.unwrap_or_else(|| Box::new(|x: String| x.to_lowercase()));

        WordCode {
            dict_name,
            words,
            bits_per_word,
            normalizer,
            word_positions: None,
        }
    }

    fn fill_word_positions(&mut self) {
        if self.word_positions.is_none() {
            let mut word_positions = HashMap::new();
            for (pos, word) in self.words.iter().enumerate() {
                word_positions.insert((self.normalizer)(word.clone()), pos);
            }
            self.word_positions = Some(word_positions);
        }
    }

    pub fn encode(&self, hex: &str) -> Result<Vec<String>, String> {
        let nibbles_per_word = (self.bits_per_word / 4.0).ceil() as usize;

        if hex.len() % nibbles_per_word != 0 {
            return Err("Hex string length is not a multiple of the bits-per-word constant.".to_string());
        }

        let words = hex
            .as_bytes()
            .chunks(nibbles_per_word)
            .map(|chunk| {
                let chunk_str = String::from_utf8_lossy(chunk);
                let pos = usize::from_str_radix(&chunk_str, 16).unwrap();
                self.words.get(pos).unwrap().clone()
            })
            .collect();

        Ok(words)
    }

    pub fn decode(&mut self, words: &[String]) -> Result<String, String> {
        self.fill_word_positions();

        let nibbles_per_word = (self.bits_per_word / 4.0).ceil() as usize;

        let mut result = String::new();

        for word in words {
            let position = self
                .word_positions
                .as_ref()
                .unwrap()
                .get(&(self.normalizer)(word.clone()));

            match position {
                Some(pos) => {
                    result.push_str(&format!("{:0width$X}", pos, width = nibbles_per_word));
                }
                None => {
                    return Err(format!(
                        "Received a word that is not in the dictionary '{}': {}",
                        self.dict_name, word
                    ));
                }
            }
        }

        Ok(result)
    }

    pub fn check(&mut self, word: &str) -> bool {
        self.fill_word_positions();
        self.word_positions.as_ref().unwrap().contains_key(&(self.normalizer)(word.to_string()))
    }
}
