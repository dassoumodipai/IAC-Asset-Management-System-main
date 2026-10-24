export function formatInr(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function fyOptions(today = new Date()) {
  const startYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return Array.from({ length: 6 }, (_, index) => {
    const year = startYear - index;
    return { value: String(year), label: `FY ${year}-${String(year + 1).slice(-2)}` };
  });
}

export function humaniseAction(action: string) {
  const words = action.toLowerCase().split('_').filter(Boolean);
  return words
    .map((word, index) => (index === 0 ? `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}` : word))
    .join(' ');
}

export function barPercent(value: number, max: number) {
  return max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
}
