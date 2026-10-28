/* Suspect Lineup (Module 2): narrow 30 suspects down to one with WHERE. */

export const SUSPECTS_SETUP = `
CREATE TABLE suspects (
  suspect_id integer PRIMARY KEY, name text, face text, age integer, height_cm integer,
  hair text, has_hat boolean, shoe_size integer, vehicle text, alibi text, last_seen text
);
INSERT INTO suspects VALUES
  (1,'Mara','🧑‍🦰',34,172,'red',false,39,NULL,NULL,'station'),
  (2,'Rufus','👨‍🦰',45,185,'red',true,44,'car','at the cinema','park'),
  (3,'Ginny','👩‍🦰',29,183,'red',false,40,'bicycle','with friends','cafe'),
  (4,'Otto','🧔',52,188,'red',false,45,'car',NULL,'library'),
  (5,'Tessa','👩‍🦰',38,165,'red',true,38,'scooter','home alone','park'),
  (6,'Ian','👨‍🦰',23,178,'red',true,42,NULL,'gym','station'),
  (7,'Milo','🧑',31,176,'brown',false,42,NULL,'bowling','park'),
  (8,'Mina','👩',37,168,'black',true,37,'bicycle','work','station'),
  (9,'Marcus','👨',42,181,'black',false,43,'car',NULL,'cafe'),
  (10,'Moira','👵',67,160,'grey',true,37,NULL,NULL,'library'),
  (11,'Max','👦',19,174,'blonde',false,41,'scooter',NULL,'park'),
  (12,'Nadia','👩',33,170,'brown',false,38,NULL,NULL,'station'),
  (13,'Sven','🧔',48,190,'blonde',true,46,'car','fishing','park'),
  (14,'Lola','👩',27,162,'black',false,36,NULL,'class','station'),
  (15,'Theo','🧑',35,184,'brown',true,44,NULL,NULL,'station'),
  (16,'Priya','👩',41,158,'black',false,37,'scooter','call','cafe'),
  (17,'Hugo','👨',56,179,'grey',false,43,'car',NULL,'library'),
  (18,'Zara','👩',30,171,'red',false,39,NULL,'dinner','cafe'),
  (19,'Kofi','👨',39,186,'black',true,45,'bicycle','match','park'),
  (20,'Elif','👩',26,167,'brown',true,38,NULL,NULL,'park'),
  (21,'Bruno','🧔',44,192,'brown',false,47,NULL,'night shift','library'),
  (22,'Ines','👩',36,169,'blonde',false,39,'car','gym','station'),
  (23,'Omar','👨',32,177,'black',false,42,NULL,'prayer','cafe'),
  (24,'Freya','👩‍🦰',28,181,'red',false,41,'scooter',NULL,'station'),
  (25,'Dmitri','👨',50,183,'grey',true,44,'car',NULL,'park'),
  (26,'Yuki','👩',24,163,'black',false,37,NULL,'library','library'),
  (27,'Liam','👦',21,182,'blonde',false,43,'bicycle',NULL,'park'),
  (28,'Ana','👩',45,166,'brown',true,38,NULL,NULL,'station'),
  (29,'Rosa','👩‍🦰',40,175,'red',true,39,'car','choir','cafe'),
  (30,'Jonas','🧑',33,180,'brown',false,44,'scooter','concert','station');`;

export interface Clue {
  text: string;
  /** The condition this clue corresponds to (used by tests and the hint). */
  sql: string;
}

export interface LineupCase {
  title: string;
  story: string;
  clues: Clue[];
  culpritId: number;
}

export const LINEUP_CASES: LineupCase[] = [
  {
    title: 'The Stolen Painting',
    story: 'A painting vanished from the museum. Three witnesses saw the thief.',
    clues: [
      { text: '👁 Witness 1: "The thief had **red hair**."', sql: "hair = 'red'" },
      { text: '👁 Witness 2: "Tall, **taller than 180 cm**."', sql: 'height_cm > 180' },
      { text: '👁 Witness 3: "They **wore a hat**."', sql: 'has_hat' },
    ],
    culpritId: 2,
  },
  {
    title: 'The Missing Manuscript',
    story: 'A rare manuscript disappeared from the archive.',
    clues: [
      { text: '📝 A torn note signed with a name **starting with "M"** (any case).', sql: "name ILIKE 'm%'" },
      { text: '👁 The guard says the suspect was **between 30 and 40** years old (inclusive).', sql: 'age BETWEEN 30 AND 40' },
      { text: '🕵️ The culprit has **no alibi** at all.', sql: 'alibi IS NULL' },
    ],
    culpritId: 1,
  },
  {
    title: 'The Muddy Footprints',
    story: 'Someone broke into the bakery overnight and left footprints.',
    clues: [
      { text: '🚉 They were last seen at the **station or the park**.', sql: "last_seen IN ('station', 'park')" },
      { text: '🚶 They came **on foot**, so no vehicle is recorded.', sql: 'vehicle IS NULL' },
      { text: '🧢 The security camera shows **no hat**.', sql: 'NOT has_hat' },
      { text: '👣 The footprints are **bigger than size 40**.', sql: 'shoe_size > 40' },
    ],
    culpritId: 7,
  },
];
