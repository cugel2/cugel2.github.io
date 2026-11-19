// Hand-set sample passages for the mock-up. The full app will load cleaned
// Project Gutenberg texts, one file per chapter, in this same small markup:
//   # Heading            shown, not typed
//   [Stage direction]    shown, not typed
//   @SPEAKER. words      speaker shown, not typed; the words are typed
//   12 words             verse number 12 in the margin, not typed
//   blank line           new paragraph; a single newline is a verse line break
window.COPYIST_SAMPLES = [
  {
    id: "kjv-genesis-1",
    title: "Genesis 1",
    source: "King James Bible",
    kind: "verse",
    text: `# Genesis 1

1 In the beginning God created the heaven and the earth.

2 And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.

3 And God said, Let there be light: and there was light.

4 And God saw the light, that it was good: and God divided the light from the darkness.

5 And God called the light Day, and the darkness he called Night. And the evening and the morning were the first day.

6 And God said, Let there be a firmament in the midst of the waters, and let it divide the waters from the waters.

7 And God made the firmament, and divided the waters which were under the firmament from the waters which were above the firmament: and it was so.

8 And God called the firmament Heaven. And the evening and the morning were the second day.

9 And God said, Let the waters under the heaven be gathered together unto one place, and let the dry land appear: and it was so.

10 And God called the dry land Earth; and the gathering together of the waters called he Seas: and God saw that it was good.

11 And God said, Let the earth bring forth grass, the herb yielding seed, and the fruit tree yielding fruit after his kind, whose seed is in itself, upon the earth: and it was so.

12 And the earth brought forth grass, and herb yielding seed after his kind, and the tree yielding fruit, whose seed was in itself, after his kind: and God saw that it was good.

13 And the evening and the morning were the third day.

14 And God said, Let there be lights in the firmament of the heaven to divide the day from the night; and let them be for signs, and for seasons, and for days, and years:

15 And let them be for lights in the firmament of the heaven to give light upon the earth: and it was so.

16 And God made two great lights; the greater light to rule the day, and the lesser light to rule the night: he made the stars also.

17 And God set them in the firmament of the heaven to give light upon the earth,

18 And to rule over the day and over the night, and to divide the light from the darkness: and God saw that it was good.

19 And the evening and the morning were the fourth day.

20 And God said, Let the waters bring forth abundantly the moving creature that hath life, and fowl that may fly above the earth in the open firmament of heaven.

21 And God created great whales, and every living creature that moveth, which the waters brought forth abundantly, after their kind, and every winged fowl after his kind: and God saw that it was good.

22 And God blessed them, saying, Be fruitful, and multiply, and fill the waters in the seas, and let fowl multiply in the earth.

23 And the evening and the morning were the fifth day.

24 And God said, Let the earth bring forth the living creature after his kind, cattle, and creeping thing, and beast of the earth after his kind: and it was so.

25 And God made the beast of the earth after his kind, and cattle after their kind, and every thing that creepeth upon the earth after his kind: and God saw that it was good.

26 And God said, Let us make man in our image, after our likeness: and let them have dominion over the fish of the sea, and over the fowl of the air, and over the cattle, and over all the earth, and over every creeping thing that creepeth upon the earth.

27 So God created man in his own image, in the image of God created he him; male and female created he them.

28 And God blessed them, and God said unto them, Be fruitful, and multiply, and replenish the earth, and subdue it: and have dominion over the fish of the sea, and over the fowl of the air, and over every living thing that moveth upon the earth.

29 And God said, Behold, I have given you every herb bearing seed, which is upon the face of all the earth, and every tree, in the which is the fruit of a tree yielding seed; to you it shall be for meat.

30 And to every beast of the earth, and to every fowl of the air, and to every thing that creepeth upon the earth, wherein there is life, I have given every green herb for meat: and it was so.

31 And God saw every thing that he had made, and, behold, it was very good. And the evening and the morning were the sixth day.`
  },
  {
    id: "shakespeare-hamlet-1-1",
    title: "Hamlet, Act I, Scene 1",
    source: "Shakespeare",
    kind: "play",
    text: `# Hamlet · Act I, Scene 1

[Elsinore. A platform before the Castle.]

[Enter Bernardo and Francisco, two Sentinels.]

@BERNARDO. Who’s there?

@FRANCISCO. Nay, answer me: stand, and unfold yourself.

@BERNARDO. Long live the King!

@FRANCISCO. Bernardo?

@BERNARDO. He.

@FRANCISCO. You come most carefully upon your hour.

@BERNARDO. ’Tis now struck twelve. Get thee to bed, Francisco.

@FRANCISCO. For this relief much thanks: ’tis bitter cold,
And I am sick at heart.

@BERNARDO. Have you had quiet guard?

@FRANCISCO. Not a mouse stirring.

@BERNARDO. Well, good night.
If you do meet Horatio and Marcellus,
The rivals of my watch, bid them make haste.

@FRANCISCO. I think I hear them. Stand, ho! Who is there?

[Enter Horatio and Marcellus.]

@HORATIO. Friends to this ground.

@MARCELLUS. And liegemen to the Dane.

@FRANCISCO. Give you good night.`
  },
  {
    id: "shakespeare-sonnet-18",
    title: "Sonnet 18",
    source: "Shakespeare",
    kind: "poem",
    text: `# Sonnet XVIII

Shall I compare thee to a summer’s day?
Thou art more lovely and more temperate:
Rough winds do shake the darling buds of May,
And summer’s lease hath all too short a date:
Sometime too hot the eye of heaven shines,
And often is his gold complexion dimm’d;
And every fair from fair sometime declines,
By chance, or nature’s changing course, untrimm’d;
But thy eternal summer shall not fade,
Nor lose possession of that fair thou ow’st;
Nor shall Death brag thou wander’st in his shade,
When in eternal lines to time thou grow’st:
So long as men can breathe or eyes can see,
So long lives this, and this gives life to thee.`
  },
  {
    id: "gibbon-1-opening",
    title: "Decline and Fall, Chapter I",
    source: "Gibbon",
    kind: "prose",
    text: `# Chapter I · The Extent of the Empire in the Age of the Antonines

In the second century of the Christian Æra, the empire of Rome comprehended the fairest part of the earth, and the most civilized portion of mankind. The frontiers of that extensive monarchy were guarded by ancient renown and disciplined valor. The gentle but powerful influence of laws and manners had gradually cemented the union of the provinces. Their peaceful inhabitants enjoyed and abused the advantages of wealth and luxury. The image of a free constitution was preserved with decent reverence: the Roman senate appeared to possess the sovereign authority, and devolved on the emperors all the executive powers of government.`
  }
];
