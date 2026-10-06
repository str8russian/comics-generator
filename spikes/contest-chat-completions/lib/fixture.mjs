// Synthetic Russian Structure-storyboard probe. Fictional bakery errand.
// Size is meant to sit near the existing 19-frame viewer payload (~30 KB).
// It is not the application contract and contains no source dialogue.

const MARINA = 'Марина';
const ILYA = 'Илья';

const FRAMES = [
  {
    speaker: MARINA,
    layout: 'split2',
    derived: false,
    dialogue: 'Илья, торт для семейного обеда уже собран. Забери его до четырёх, пока крем не осел.',
    note: 'Базовая двухпанельная композиция: Марина слева за прилавком, Илья справа у двери. Её реплика лежит под левой панелью.',
  },
  {
    speaker: ILYA,
    layout: 'split2',
    derived: false,
    dialogue: 'Я как раз у пекарни. Повтори, пожалуйста, для кого записка на коробке.',
    note: 'Та же композиция. Говорит Илья, поэтому полный текст стоит под правой панелью, а Марина остаётся в кадре.',
  },
  {
    speaker: MARINA,
    layout: 'split2',
    derived: false,
    dialogue: 'Для семьи Орловых. Напиши, что внутри вишня и что коробку нужно держать ровно.',
    note: 'Записка — деталь заказа, а не новый персонаж. Имена на коробке не становятся отдельными говорящими.',
  },
  {
    speaker: ILYA,
    layout: 'single',
    derived: true,
    dialogue: '',
    note: 'Производная пауза без реплики: Илья проверяет ремешок сумки. Это не текст на экране, а описание действия.',
  },
  {
    speaker: ILYA,
    layout: 'split2',
    derived: false,
    dialogue: 'Вишня и держать ровно. А свечи они просили, или свечи останутся здесь?',
    note: 'Возврат к двухпанельному разговору после паузы. Состав панелей не меняется.',
  },
  {
    speaker: MARINA,
    layout: 'single',
    derived: false,
    dialogue: 'Свечи в маленьком пакете сверху. Не клади их под коробку.',
    note: 'Одиночный кадр для короткого указания. Пакет со свечами — предмет в руках, не отдельная сцена.',
  },
  {
    speaker: ILYA,
    layout: 'split2',
    derived: false,
    dialogue: 'Понял. Если во дворе дождь, я укрою коробку плащом и напишу тебе.',
    note: 'Дождь пока только возможность. Не показывать мокрую коробку как уже случившийся факт.',
  },
  {
    speaker: MARINA,
    layout: 'split2',
    derived: false,
    dialogue: 'Напиши только если опоздаешь больше чем на десять минут.',
    note: 'Условие остаётся репликой Марины. Не превращать его в отдельное экранное правило.',
  },
  {
    speaker: ILYA,
    layout: 'single',
    derived: false,
    dialogue: 'До четырёх успею. Я оставлю коробку у двери и позвоню два раза.',
    note: 'Одиночный кадр фиксирует обещание Ильи. Дверь ещё не показана крупно.',
  },
  {
    speaker: MARINA,
    layout: 'split2',
    derived: false,
    dialogue: 'Два звонка — значит, торт на месте. Третий звонок будет значить, что нужна помощь.',
    note: 'Сигнал звонками остаётся договорённостью между двумя людьми. Не добавлять третьего говорящего.',
  },
  {
    speaker: ILYA,
    layout: 'split2',
    derived: false,
    dialogue: 'Третий звонок не понадобится. Спасибо, что собрала торт без спешки.',
    note: 'Благодарность не меняет композицию. Оба персонажа по-прежнему в пекарне.',
  },
  {
    speaker: MARINA,
    layout: 'single',
    derived: true,
    dialogue: '',
    note: 'Производное тихое действие: Марина смотрит, как Илья выходит во двор. Реплики нет, подпись на кадре не нужна.',
  },
  {
    speaker: MARINA,
    layout: 'split2',
    derived: false,
    dialogue: 'Илья, записка снаружи. Не открывай коробку по дороге, даже если запах сильный.',
    note: 'Илья ещё в дверях, разговор продолжается. Коробка закрыта.',
  },
  {
    speaker: ILYA,
    layout: 'single',
    derived: false,
    dialogue: 'Не открою. До встречи у дома Орловых.',
    note: 'Короткий одиночный ответ. Дом Орловых назван, но не показан.',
  },
  {
    speaker: MARINA,
    layout: 'split2',
    derived: false,
    dialogue: 'До встречи. Если они предложат чай, торт всё равно сначала поставь на стол.',
    note: 'Чай — чужое возможное действие, не повод добавлять гостей в этот кадр.',
  },
  {
    speaker: ILYA,
    layout: 'split2',
    derived: false,
    dialogue: 'Сначала на стол, потом разговор. Я запомнил порядок.',
    note: 'Порядок действий звучит в реплике. Не иллюстрировать будущий стол как отдельную локацию.',
  },
  {
    speaker: MARINA,
    layout: 'single',
    derived: false,
    dialogue: 'Именно так. Пусть обед начнётся с целого торта, а не с рассказа о дороге.',
    note: 'Одиночный акцент на целом торте. Дорога не становится новым кадром.',
  },
  {
    speaker: ILYA,
    layout: 'split2',
    derived: false,
    dialogue: 'Тогда я молчу, пока они сами не откроют крышку.',
    note: 'Илья принимает ограничение. Крышка остаётся закрытой в описании панелей.',
  },
  {
    speaker: MARINA,
    layout: 'split2',
    derived: false,
    dialogue: 'Молчи и улыбайся. На сегодня это вся роль курьера.',
    note: 'Последний кадр закрывает разговор в пекарне. Не добавлять кадр вручения торта: его нет в репликах.',
  },
];

function sceneDetail(index, character) {
  const light = index % 2 === 0
    ? 'Свет падает из левого окна на деревянный прилавок, стеклянные банки и закрытую коробку с тортом.'
    : 'Лампа над прилавком светит теплее, чем серый двор за стеклом, и оставляет мягкую тень под коробкой.';
  const place = character === MARINA
    ? 'Марина в льняном фартуке пекарни «Тихий двор», волосы убраны, руки в муке, взгляд спокойный и внимательный.'
    : 'Илья в простой куртке курьера, через плечо пустая сумка с широким ремнём, плечи чуть развёрнуты к прилавку.';
  return [
    place,
    light,
    'Коробка перевязана бумажным шнуром, крышка закрыта, свечи лежат отдельным маленьким пакетом сверху.',
  ].join(' ');
}

function panelsFor(frame, index) {
  const marina = {
    character: MARINA,
    description: `Марина стоит за прилавком и смотрит на собеседника. ${sceneDetail(index, MARINA)} Кадр ${index + 1}: коробка с тортом закрыта и стоит между ними.`,
  };
  const ilya = {
    character: ILYA,
    description: `Илья стоит у двери пекарни и держит ремешок сумки. ${sceneDetail(index, ILYA)} Кадр ${index + 1}: он ещё не вышел во двор и не открывает коробку.`,
  };
  if (frame.layout === 'single') {
    return [frame.speaker === ILYA ? ilya : marina];
  }
  return [marina, ilya];
}

export function structureStoryboardFixture() {
  return {
    schemaVersion: 'structure-probe-0',
    language: 'ru',
    title: 'Торт для семейного обеда',
    frames: FRAMES.map((frame, index) => ({
      id: `F${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      layout: frame.layout,
      derived: frame.derived,
      speakerPanel: frame.layout === 'single' ? 0 : (frame.speaker === ILYA ? 1 : 0),
      dialogue: frame.dialogue,
      directingNote: frame.note,
      panels: panelsFor(frame, index),
    })),
  };
}

export function fixtureJson() {
  return JSON.stringify(structureStoryboardFixture());
}
