export type ImportantDate = {
  date: string;
  title: string;
  description: string;
  category: 'official' | 'important';
};

const fixed: Array<[number, number, string, string, ImportantDate['category']]> = [
  [1, 1, 'Yılbaşı', 'Yeni takvim yılının ilk günü ve resmî tatildir.', 'official'],
  [4, 23, 'Ulusal Egemenlik ve Çocuk Bayramı', 'Türkiye Büyük Millet Meclisinin açılışını ve millî egemenliği simgeler; çocuklara armağan edilmiştir.', 'official'],
  [5, 1, 'Emek ve Dayanışma Günü', 'Emekçilerin birlik, dayanışma ve haklarını vurgulayan resmî tatildir.', 'official'],
  [5, 19, "Atatürk'ü Anma, Gençlik ve Spor Bayramı", 'Millî Mücadele başlangıcının anıldığı ve gençliğe armağan edilen resmî bayramdır.', 'official'],
  [7, 15, 'Demokrasi ve Millî Birlik Günü', 'Demokrasiye ve millî iradeye sahip çıkmanın anıldığı resmî gündür.', 'official'],
  [8, 30, 'Zafer Bayramı', 'Başkomutanlık Meydan Muharebesi zaferinin anıldığı resmî bayramdır.', 'official'],
  [10, 29, 'Cumhuriyet Bayramı', 'Türkiye Cumhuriyeti’nin ilanının kutlandığı resmî bayramdır.', 'official'],
  [3, 8, 'Dünya Kadınlar Günü', 'Kadınların toplumsal, ekonomik, kültürel ve siyasal başarılarına dikkat çeken uluslararası gündür.', 'important'],
  [6, 5, 'Dünya Çevre Günü', 'Çevrenin korunması ve sürdürülebilir yaşam konusunda farkındalık oluşturmayı amaçlar.', 'important'],
  [11, 10, "Atatürk'ü Anma Günü", 'Gazi Mustafa Kemal Atatürk’ün saygı ve minnetle anıldığı gündür.', 'important'],
  [11, 24, 'Öğretmenler Günü', 'Öğretmenlerin eğitimdeki emeğini ve toplumsal katkısını onurlandıran gündür.', 'important'],
];

export function importantDatesForYear(year: number): ImportantDate[] {
  return fixed.map(([month, day, title, description, category]) => ({
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    title,
    description,
    category,
  }));
}

export function importantDateMap(year: number): Map<string, ImportantDate[]> {
  const map = new Map<string, ImportantDate[]>();
  for (const item of importantDatesForYear(year)) {
    const list = map.get(item.date) ?? [];
    list.push(item);
    map.set(item.date, list);
  }
  return map;
}
