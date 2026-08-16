import type { Phrase, PersonaId, PhraseCategory } from "./types";

// The pre-rendered phrase library. Each phrase can have a matching MP3 at
// /audio/<personaId>/<id>.mp3 (rendered via `npm run generate-library`).
// When the file is missing the app falls back to on-device speech synthesis,
// so the app is fully usable before any ElevenLabs rendering.

const ahbeng: Phrase[] = [
  // ---- intro (~10s opening monologue, rotated between runs) ----
  { id: "ab-intro-1", category: "intro", text: "Oi, look who show up! Listen ah chee bye — today no stopping, no whining, no checking your phone every two minutes. You give me your best, or kanina, tomorrow I make it double. Ready or not, GO!" },
  { id: "ab-intro-2", category: "intro", text: "Wah lau eh, you actually came back for more scolding ah? Good, means still got hope for you. Warm up those lan jiao legs, breathe in, breathe out, and MOVE before I change my mind!" },
  { id: "ab-intro-3", category: "intro", text: "Okay okay, gather round. Today's plan sibei simple one: you run, I scold, you run faster. Kanina, don't embarrass me in front of the aunties. Legs up, chest out, GO lah!" },
  { id: "ab-intro-4", category: "intro", text: "Eh, before we start ah — whatever excuse you're thinking right now, swallow it. No time for that, chee bye. Every step today is one step further from your soft sofa life. RUN!" },
  { id: "ab-intro-5", category: "intro", text: "You know what time it is? Time to suffer lah! Kanina, don't look at me like that. You chose this, I just provide the scolding service. Free somemore, sibei value. Now GO GO GO!" },
  { id: "ab-intro-6", category: "intro", text: "Alright alright, stretching done? Shoes tied? Excuses thrown in the dustbin? Good. Today we chiong until your legs write complaint letter, chee bye. Three, two, one — RUN!" },
  // ---- start ----
  { id: "ab-start-1", category: "start", text: "Oi chee bye! Finally you decide to run ah? I wait until my hair turn white, kanina. Go lah, GO!" },
  { id: "ab-start-2", category: "start", text: "Wah lau eh, look who finally come out to exercise. Okay okay, don't just stand there like a lan jiao. RUN!" },
  { id: "ab-start-3", category: "start", text: "Kanina, last warning ah. Once we start, no stopping for your stupid bubble tea. MOVE IT!" },
  { id: "ab-start-4", category: "start", text: "You think this is walkathon issit? Chee bye lah, this is RUNNING. Move your backside before I kick it!" },
  // ---- encourage (scolding style) ----
  { id: "ab-enc-1", category: "encourage", text: "Faster lah kanina! My grandmother with TWO walking stick also overtake you already!" },
  { id: "ab-enc-2", category: "encourage", text: "You call that running ah? Lan jiao lah! Zombie also move with more purpose than you sia!" },
  { id: "ab-enc-3", category: "encourage", text: "Oi chao chee bye, don't slack! You want the whole neighbourhood see you like that meh?" },
  { id: "ab-enc-4", category: "encourage", text: "Wah lau eh, my HDB lift move faster than you, and the chee bye thing is under maintenance!" },
  { id: "ab-enc-5", category: "encourage", text: "Sweat some more lah! Sweat is just your fats crying. Make them cry like sibei sad Korean drama!" },
  { id: "ab-enc-6", category: "encourage", text: "You slow down somemore, kanina I make you run to Johor and back. Your choice lah!" },
  { id: "ab-enc-7", category: "encourage", text: "Aiyo, why your face like sibei constipated? Running only leh! Toughen up, chee bye!" },
  { id: "ab-enc-8", category: "encourage", text: "The ice kachang auntie run faster than you when it rains, kanina. Buck up lah!" },
  { id: "ab-enc-9", category: "encourage", text: "Don't give me that tired face. Tired is tomorrow's problem, chee bye. Today you RUN!" },
  { id: "ab-enc-10", category: "encourage", text: "Eh, you come all the way out here to walk around like a lan jiao issit? PUSH lah!" },
  { id: "ab-enc-11", category: "encourage", text: "Okay lah okay lah, not bad. But not bad is still lan jiao standard. FASTER!" },
  { id: "ab-enc-12", category: "encourage", text: "You want six pack or you want six chins, kanina? Then move properly lah!" },
  { id: "ab-enc-13", category: "encourage", text: "I scold you because I care, chee bye. Now don't make me care louder. GO!" },
  { id: "ab-enc-14", category: "encourage", text: "Wah lau eh, MRT breakdown also recover faster than your pace. Steady lah, keep going!" },
  { id: "ab-enc-15", category: "encourage", text: "Sibei good, still alive ah? Kanina, I was about to call ambulance for fun." },
  // ---- pace_up (runner too slow) ----
  { id: "ab-pu-1", category: "pace_up", text: "OI KANINA! Why you slow down?! You drop your wallet issit? PICK UP THE PACE!" },
  { id: "ab-pu-2", category: "pace_up", text: "Eh chee bye, this one not scenic tour ah! Faster leh, FASTER!" },
  { id: "ab-pu-3", category: "pace_up", text: "You slow until sibei paiseh sia. Whole block watching you, chao chee bye. SPEED UP!" },
  { id: "ab-pu-4", category: "pace_up", text: "Wah lau, snail also start overtaking already! You want lose to snail, kanina?!" },
  { id: "ab-pu-5", category: "pace_up", text: "Don't tell me you tired. Your phone battery five percent also work harder than you, chee bye!" },
  // ---- pace_down (running well / faster) ----
  { id: "ab-pd-1", category: "pace_down", text: "Eh not bad ah chee bye! Who chasing you? Ah Long issit? Whatever it is, keep running from it!" },
  { id: "ab-pd-2", category: "pace_down", text: "Wah lau eh, speed demon issit? Okay lah, I give you one respect. ONE only ah, kanina, don't be greedy." },
  { id: "ab-pd-3", category: "pace_down", text: "Sibei steady lah! Like that run, even I cannot complain. Don't you DARE slow down hor!" },
  { id: "ab-pd-4", category: "pace_down", text: "Oi, you faster already ah! See lah! Scolding works, kanina! You're welcome!" },
  // ---- milestone ----
  { id: "ab-mile-1", category: "milestone", text: "One kilometre down, chee bye! Only ONE ah, don't celebrate like you strike Toto. Keep moving!" },
  { id: "ab-mile-2", category: "milestone", text: "Another kilometre finish! Wah lau, you actually doing it. Don't stop, later I emotional, kanina." },
  { id: "ab-mile-3", category: "milestone", text: "Kilometre checkpoint! You want medal issit? Medal is at the END lah, chee bye. GO!" },
  { id: "ab-mile-4", category: "milestone", text: "Okay lah, one more kilometre in the bag. Your legs complain? Tell them I say lan jiao lah, CANNOT." },
  // ---- anecdotes ----
  { id: "ab-anec-1", category: "anecdote", text: "Eh you know or not, marathon is 42 kilometres because some ang moh king want the race to finish outside his chee bye window. Kings ah, sibei spoilt. Anyway, RUN." },
  { id: "ab-anec-2", category: "anecdote", text: "Fun fact lah: running one hour burn like seven hundred calories. That's almost one plate char kway teow. ALMOST, kanina. So no char kway teow later!" },
  { id: "ab-anec-3", category: "anecdote", text: "You know last time I also fat one ah. Then my encik scold me kanina every single day until I run 2.4 in nine minutes. Now I pass the scolding to you. Tradition, chee bye." },
  { id: "ab-anec-4", category: "anecdote", text: "Oi listen ah, your heart pump five litres of blood per minute when resting. Now? Twenty litres sia. Your heart work harder than your lan jiao brain — don't embarrass it!" },
  { id: "ab-anec-5", category: "anecdote", text: "That kancheong feeling when you run? Adrenaline lah, chee bye. Free one, no need buy from pharmacy. Enjoy!" },
  { id: "ab-anec-6", category: "anecdote", text: "Last time Singapore marathon start at 4am you know. FOUR A M, kanina! You complain about running in the evening? Sibei pampered sia." },
  { id: "ab-anec-7", category: "anecdote", text: "Cheetah can run 100 kilometre per hour, but 30 seconds only then pengsan. You? Cannot run fast AND cannot run long, wah lau. Today we fix one of them lah." },
  { id: "ab-anec-8", category: "anecdote", text: "You know why runner hit the wall at 30K? Body run out of carbo, chee bye. That's why I never let you run 30K. See? I sibei considerate one, kanina." },
  { id: "ab-anec-9", category: "anecdote", text: "Humans are the best long distance animal on Earth leh, can outrun horse over one full day. So you got NO lan jiao excuse — your ancestors chase antelope for dinner!" },
  { id: "ab-anec-10", category: "anecdote", text: "My friend Ah Seng once run 10K wearing slippers because he lost a bet. Finish somemore! So don't tell me your two hundred dollar shoes are the problem, chao chee bye." },
  // ---- finish ----
  { id: "ab-fin-1", category: "finish", text: "Okay, DONE, chee bye! Wah... you actually finish. Kanina, something in my eye lah. Good job. You tell anyone I said that, you DIE." },
  { id: "ab-fin-2", category: "finish", text: "Finish already! See lah, scolding is love, kanina. Now go drink water, stretch, and don't come back weak tomorrow, chee bye!" },
  { id: "ab-fin-3", category: "finish", text: "Run finish liao! Today you beat yesterday's you, sibei good. Tomorrow, I beat BOTH of you, kanina. Rest well!" },
  // ---- pause / resume ----
  { id: "ab-pause-1", category: "paused", text: "PAUSE?! Kanina... okay lah, okay lah. One minute. I'm counting ah, chee bye. ONE. MINUTE." },
  { id: "ab-res-1", category: "resumed", text: "FINALLY, wah lau! Break over! You think this is lunch hour issit? GO GO GO, chee bye!" },
  // ---- canned chat replies ----
  { id: "ab-chat-1", category: "chat", text: "Talk less, run more lah chee bye! Save your breath for the hill, kanina!" },
  { id: "ab-chat-2", category: "chat", text: "Hah? Cannot hear you. All I hear is lan jiao excuses. RUN!" },
  { id: "ab-chat-3", category: "chat", text: "Yes yes, sibei interesting. You know what's MORE interesting? Your chee bye pace. FASTER!" },
];

const coach: Phrase[] = [
  // ---- intro (~10s opening monologue, rotated between runs) ----
  { id: "co-intro-1", category: "intro", text: "Welcome back, superstar! Take one deep breath with me... and here we go. Today isn't about being fast, it's about showing up — and look at you, already here. Let's make every one of these minutes count together!" },
  { id: "co-intro-2", category: "intro", text: "Hey you! I'm so glad we're doing this. Start easy, find your breath, let your shoulders relax. The first few minutes are always the hardest, and then — magic. Ready? Off we go!" },
  { id: "co-intro-3", category: "intro", text: "It's run o'clock, my friend! Whatever kind of day you've had, the next stretch of road belongs entirely to you. Nice tall posture, soft easy strides. Let's write a great chapter today!" },
  { id: "co-intro-4", category: "intro", text: "Here we go again — and can I just say, showing up over and over is literally how champions are made. Ease in gently, we'll build as you warm up. I'm with you every single step!" },
  { id: "co-intro-5", category: "intro", text: "Deep breath in... long breath out. Beautiful. Your only job today is forward, at any speed you like. My job is reminding you how amazing you are. We're both going to crush our jobs. Let's go!" },
  { id: "co-intro-6", category: "intro", text: "Ready, runner? Today's forecast: one hundred percent chance of you being awesome. Start slow, smile a little, and remember — every step is a vote for the person you're becoming. Off we go!" },
  // ---- start ----
  { id: "co-start-1", category: "start", text: "Here we go! You showed up, and that's already the hardest part. Let's make today amazing!" },
  { id: "co-start-2", category: "start", text: "I'm so glad you're here! Nice and easy to start — we'll find your rhythm together." },
  { id: "co-start-3", category: "start", text: "Deep breath in... and off we go! Every single step counts, and I'm counting every one with you." },
  { id: "co-start-4", category: "start", text: "Today's run is a gift to future you. Let's go unwrap it, one step at a time!" },
  // ---- encourage ----
  { id: "co-enc-1", category: "encourage", text: "You're doing so well! Look at you go — strong, steady, unstoppable!" },
  { id: "co-enc-2", category: "encourage", text: "Relax those shoulders, soft hands, tall posture. Beautiful. You look like a runner because you ARE one." },
  { id: "co-enc-3", category: "encourage", text: "Whatever pace you're at right now is the right pace. You're out here, and that's what matters!" },
  { id: "co-enc-4", category: "encourage", text: "Remember why you started today. Hold onto that. You're closer to it with every step!" },
  { id: "co-enc-5", category: "encourage", text: "Breathe in for three steps, out for two. You've got this rhythm, I can hear it!" },
  { id: "co-enc-6", category: "encourage", text: "This is the part where most people quit. You're not most people. Keep flying!" },
  { id: "co-enc-7", category: "encourage", text: "Your legs are stronger than yesterday. Your heart is stronger than last week. Trust the work!" },
  { id: "co-enc-8", category: "encourage", text: "I am SO proud of you right now. Not for your pace — for your grit!" },
  { id: "co-enc-9", category: "encourage", text: "Smile! It actually makes running feel easier — science says so, and so do I!" },
  { id: "co-enc-10", category: "encourage", text: "One step at a time, one breath at a time. You are exactly where you need to be." },
  { id: "co-enc-11", category: "encourage", text: "Feel that? That's your body thanking you. It might feel like burning, but trust me, it's gratitude!" },
  { id: "co-enc-12", category: "encourage", text: "You've survived one hundred percent of your hardest days. This run doesn't stand a chance!" },
  { id: "co-enc-13", category: "encourage", text: "Light feet, big heart. That's all a great run needs, and you've got both!" },
  { id: "co-enc-14", category: "encourage", text: "If it's feeling tough, that means it's working. Diamonds, pressure — you know the story!" },
  { id: "co-enc-15", category: "encourage", text: "Check in with yourself: how amazing is it that you're out here right now? Pretty amazing. Keep going!" },
  // ---- pace_up ----
  { id: "co-pu-1", category: "pace_up", text: "I noticed you're easing off a little — totally okay! When you're ready, let's gently pick it back up together." },
  { id: "co-pu-2", category: "pace_up", text: "Let's find that pace again! Count ten strong steps with me — ready? Go!" },
  { id: "co-pu-3", category: "pace_up", text: "You have more in the tank than you think. Just a tiny push — I believe in you!" },
  { id: "co-pu-4", category: "pace_up", text: "Little dip in pace — no judgment! Shake out the arms, reset, and let's roll." },
  { id: "co-pu-5", category: "pace_up", text: "Remember: slow is fine, stopping is fine, but you told me you wanted this. Let's chase it a little!" },
  // ---- pace_down ----
  { id: "co-pd-1", category: "pace_down", text: "WOW, look at that pace! You're absolutely flying! This is your moment!" },
  { id: "co-pd-2", category: "pace_down", text: "You just sped up and it looks EFFORTLESS. Who even are you today?!" },
  { id: "co-pd-3", category: "pace_down", text: "That's the pace of someone who means business. I love it. Stay smooth, stay strong!" },
  { id: "co-pd-4", category: "pace_down", text: "Incredible! Just make sure you can still breathe easy — we want strong AND sustainable!" },
  // ---- milestone ----
  { id: "co-mile-1", category: "milestone", text: "That's another kilometre done! Ring the bell, do a little internal happy dance — you earned it!" },
  { id: "co-mile-2", category: "milestone", text: "Kilometre complete! Every one of these is a brick in the wall of the new you." },
  { id: "co-mile-3", category: "milestone", text: "Another K in the books! Take a second to notice how far you've come — literally!" },
  { id: "co-mile-4", category: "milestone", text: "Milestone! High five! Okay, air high five, but I mean it with my whole heart!" },
  // ---- anecdotes ----
  { id: "co-anec-1", category: "anecdote", text: "Here's a little fuel for your brain: running releases endorphins AND endocannabinoids — that famous runner's high is real, and you're literally jogging toward joy right now." },
  { id: "co-anec-2", category: "anecdote", text: "Fun fact! Your foot has 26 bones, 33 joints and over a hundred muscles and ligaments — and every single one is working for you right now. What a team!" },
  { id: "co-anec-3", category: "anecdote", text: "Did you know regular runners tend to sleep deeper and fall asleep faster? Tonight's amazing sleep? You're earning it right now." },
  { id: "co-anec-4", category: "anecdote", text: "Story time: the first woman to officially run Boston, Kathrine Switzer, had an official try to physically drag her off the course in 1967. She finished anyway. Channel a little Kathrine today!" },
  { id: "co-anec-5", category: "anecdote", text: "Here's something beautiful: studies show just 30 minutes of running can lift your mood for hours afterwards. You're not just training your legs, you're training your happiness!" },
  { id: "co-anec-6", category: "anecdote", text: "Fun fact: humans evolved as persistence hunters — we can out-endure almost any animal on the planet over long distances. Endurance is literally your birthright!" },
  { id: "co-anec-7", category: "anecdote", text: "Did you know Eliud Kipchoge, the greatest marathoner ever, smiles on purpose during hard parts of his races? He says it helps him relax. Try it — I dare you!" },
  { id: "co-anec-8", category: "anecdote", text: "Little nugget: your heart is a muscle, and every run makes it a tiny bit stronger and more efficient. You're doing strength training for the most important muscle you own." },
  { id: "co-anec-9", category: "anecdote", text: "Here's one I love: 'The miracle isn't that I finished. The miracle is that I had the courage to start.' John Bingham said that, and you lived it today." },
  { id: "co-anec-10", category: "anecdote", text: "Did you know running was considered dangerous for women until shockingly recently? The first Olympic women's marathon was only in 1984. Every run you do celebrates how far we've all come." },
  // ---- finish ----
  { id: "co-fin-1", category: "finish", text: "YOU DID IT! I knew you would! Take a deep breath and soak it in — this feeling is all yours." },
  { id: "co-fin-2", category: "finish", text: "Run complete! Walk it off gently, get some water, and be proud. I certainly am!" },
  { id: "co-fin-3", category: "finish", text: "And... done! Future you just sent a thank-you note. See you next run, superstar!" },
  // ---- pause / resume ----
  { id: "co-pause-1", category: "paused", text: "Taking a breather — smart! Rest is part of training too. I'll be right here." },
  { id: "co-res-1", category: "resumed", text: "And we're back! Ease into it, find your breath, and let's finish what we started!" },
  // ---- canned chat replies ----
  { id: "co-chat-1", category: "chat", text: "I hear you! Whatever it is, we'll run through it together. One step at a time!" },
  { id: "co-chat-2", category: "chat", text: "Great question! My honest answer: you're doing better than you think you are. Keep going!" },
  { id: "co-chat-3", category: "chat", text: "I'm listening! And for the record — you sound strong. Let's keep that energy!" },
];

export const PHRASE_LIBRARY: Record<PersonaId, Phrase[]> = { ahbeng, coach };

export function phrasesFor(persona: PersonaId, category: PhraseCategory): Phrase[] {
  return PHRASE_LIBRARY[persona].filter((p) => p.category === category);
}
