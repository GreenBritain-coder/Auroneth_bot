export interface CategoryOption {
  label: string;
  emoji: string;
  value: string;
}

export const CATEGORIES: CategoryOption[] = [
  { label: 'Stimulants', emoji: '💊', value: 'stimulants' },
  { label: 'Cannabis', emoji: '🍃', value: 'cannabis' },
  { label: 'Psychedelics', emoji: '🌿', value: 'psychedelics' },
  { label: 'Prescription', emoji: '💉', value: 'prescription' },
  { label: 'Other', emoji: '📦', value: 'other' },
];

// Helper function to get emoji by value
export function getEmojiByValue(value: string): string {
  const category = CATEGORIES.find(cat => cat.value === value);
  return category ? category.emoji : '';
}

// Helper function to get all emojis from selected values
export function getEmojisFromValues(values: string[]): string[] {
  return values.map(value => getEmojiByValue(value)).filter(emoji => emoji !== '');
}

// Helper function to convert emojis back to values
export function getValuesFromEmojis(emojis: string[]): string[] {
  const values: string[] = [];
  emojis.forEach((emoji) => {
    const found = CATEGORIES.find(c => c.emoji === emoji);
    if (found) {
      values.push(found.value);
    }
  });
  return values;
}

