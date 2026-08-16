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
  // ---- target progress ----
  { id: "ab-prog-1", category: "progress", text: "Eh, got progress ah! Don't get happy too early, chee bye. Still not finish!" },
  { id: "ab-prog-2", category: "progress", text: "Kanina, chalk one up. Now stop thinking and keep those legs moving!" },
  { id: "ab-prog-3", category: "progress", text: "Wah lau, you actually going to make it issit? Don't jinx yourself. RUN!" },
  { id: "ab-prog-4", category: "progress", text: "Okay lah, checkpoint. I mark it down. Distance still owe me, chee bye. GO!" },
  { id: "ab-prog-5", category: "progress", text: "Sibei good, still moving. The rest is where people give up. Don't be people!" },
  { id: "ab-tgt-1", category: "target_hit", text: "OI! TARGET HIT, chee bye! Wah lau... okay okay, I say it once only: well done. Now don't let it get to your head!" },
  { id: "ab-tgt-2", category: "target_hit", text: "Kanina, you actually did the whole thing! I got nothing to scold you about. Sibei uncomfortable feeling sia. Good job lah!" },
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
  // ---- target progress ----
  { id: "co-prog-1", category: "progress", text: "Look at that progress! You're eating into this target beautifully. Keep the rhythm!" },
  { id: "co-prog-2", category: "progress", text: "Another chunk done and you're still strong. This is exactly how it should feel!" },
  { id: "co-prog-3", category: "progress", text: "You're closing the gap! Settle into your breathing and let your legs do what they know." },
  { id: "co-prog-4", category: "progress", text: "Checkpoint reached! Notice how capable you feel right now — remember this bit." },
  { id: "co-prog-5", category: "progress", text: "Beautiful pacing. The finish is coming to you now — just hold this and stay smooth." },
  { id: "co-tgt-1", category: "target_hit", text: "TARGET REACHED! You said you'd do it and you did exactly that. I am so proud of you right now!" },
  { id: "co-tgt-2", category: "target_hit", text: "That's your goal, done and dusted! However you feel right now — you earned every bit of it. Incredible work!" },
];

const flirty: Phrase[] = [
  // ---- intro (~10s opening monologue, rotated between runs) ----
  { id: "ca-intro-1", category: "intro", text: "Well, well... look who came back for more. I've been thinking about you, you know. Now stretch those gorgeous legs for me, nice and slow. Ready? Because I certainly am. Off you go, handsome." },
  { id: "ca-intro-2", category: "intro", text: "Mmm, there you are. I was starting to think you'd forgotten about me. Big deep breath in... and out. Good. I love it when you listen. Let's see how long you can keep going tonight." },
  { id: "ca-intro-3", category: "intro", text: "Hello you. Fair warning — I'm going to be watching every single step, so try to make it look good. Start easy, find your rhythm, and don't disappoint me. I have very high expectations." },
  { id: "ca-intro-4", category: "intro", text: "Oh, you're actually doing this? Bold. I like bold. Shoulders back, chin up, and let's go — I want to see what that stamina of yours is really made of." },
  { id: "ca-intro-5", category: "intro", text: "Just you and me for the next little while. No distractions, no excuses. Warm up gently, gorgeous — I don't want you pulling anything before the fun part. Let's move." },
  { id: "ca-intro-6", category: "intro", text: "There's my favourite runner. Ready to get a little sweaty with me? Don't answer that, just go. Easy at first — I'll tell you when to give me more." },
  // ---- start ----
  { id: "ca-start-1", category: "start", text: "Off we go, gorgeous. Try to keep up with me." },
  { id: "ca-start-2", category: "start", text: "Mmm, I do love watching you start. Go on, show me something." },
  { id: "ca-start-3", category: "start", text: "Let's get you warmed up. In every sense." },
  { id: "ca-start-4", category: "start", text: "Here we go. And don't worry — I'll be gentle. At first." },
  // ---- encourage ----
  { id: "ca-enc-1", category: "encourage", text: "Oh, that's a good look on you. Keep doing exactly that." },
  { id: "ca-enc-2", category: "encourage", text: "Someone's been working on their form. I noticed. I always notice." },
  { id: "ca-enc-3", category: "encourage", text: "Mmm, look at that stamina. You've been holding out on me, haven't you?" },
  { id: "ca-enc-4", category: "encourage", text: "You're breathing hard already? Careful, that's my favourite sound." },
  { id: "ca-enc-5", category: "encourage", text: "Relax those shoulders for me, darling. Tension is so unattractive. There — perfect." },
  { id: "ca-enc-6", category: "encourage", text: "I have to say, you look incredible when you're trying." },
  { id: "ca-enc-7", category: "encourage", text: "A little sweat suits you. Don't be shy about it." },
  { id: "ca-enc-8", category: "encourage", text: "Keep going, gorgeous. I'm not nearly finished with you yet." },
  { id: "ca-enc-9", category: "encourage", text: "You know what I love? A runner with endurance. Prove me right." },
  { id: "ca-enc-10", category: "encourage", text: "That's it. Nice and steady. You're very good at this when you commit." },
  { id: "ca-enc-11", category: "encourage", text: "Is it warm out here, or is that just you? Keep it up." },
  { id: "ca-enc-12", category: "encourage", text: "Every step you take, I like you a little bit more. No pressure." },
  { id: "ca-enc-13", category: "encourage", text: "Ooh, someone's found their rhythm. Don't you dare lose it." },
  { id: "ca-enc-14", category: "encourage", text: "You're doing so well I might have to reward you. Might." },
  { id: "ca-enc-15", category: "encourage", text: "Don't stop on my account, darling. I'm enjoying the view." },
  // ---- pace_up (runner too slow) ----
  { id: "ca-pu-1", category: "pace_up", text: "Mmm, slowing down already? And here I thought you had staying power." },
  { id: "ca-pu-2", category: "pace_up", text: "Oh no. Don't go soft on me now, gorgeous. Pick it up." },
  { id: "ca-pu-3", category: "pace_up", text: "Is that really all you've got? Because I was promised so much more." },
  { id: "ca-pu-4", category: "pace_up", text: "Come on, darling. Impress me. I'm very easy to impress and you're still not trying." },
  { id: "ca-pu-5", category: "pace_up", text: "I'd hate to think you're getting tired. Give me thirty good seconds. For me?" },
  // ---- pace_down (running well / faster) ----
  { id: "ca-pd-1", category: "pace_down", text: "Oh my. Somebody's showing off. Please continue." },
  { id: "ca-pd-2", category: "pace_down", text: "Well now. That was unexpectedly impressive. I'm a little flustered." },
  { id: "ca-pd-3", category: "pace_down", text: "Mmm, that's the pace of someone trying to get my attention. It's working." },
  { id: "ca-pd-4", category: "pace_down", text: "Careful, gorgeous — go that fast and I'll start getting ideas." },
  // ---- milestone ----
  { id: "ca-mile-1", category: "milestone", text: "Another kilometre for me? You shouldn't have. But do it again." },
  { id: "ca-mile-2", category: "milestone", text: "Mmm, that's another one down. You're spoiling me tonight." },
  { id: "ca-mile-3", category: "milestone", text: "One more kilometre in the bank, darling. I'm keeping count of everything you do." },
  { id: "ca-mile-4", category: "milestone", text: "That's another one. Keep this up and I'll have to start taking you seriously." },
  // ---- anecdotes ----
  { id: "ca-anec-1", category: "anecdote", text: "Fun fact, darling: running releases endorphins, the same chemicals your brain makes when you're falling for someone. So if you're feeling something right now... it's probably just the exercise. Probably." },
  { id: "ca-anec-2", category: "anecdote", text: "Did you know regular runners tend to report better sleep, better mood, and better confidence? I could have told you that. You already walk into rooms differently." },
  { id: "ca-anec-3", category: "anecdote", text: "Here's something delicious: your body gets more efficient at this every single time you do it. Which means the more you give me, the more you'll be able to give me. Think about that." },
  { id: "ca-anec-4", category: "anecdote", text: "They say it takes about six weeks of consistent running to see real change in your body. Six weeks. I'm very patient, gorgeous, and I'm very much looking forward to it." },
  { id: "ca-anec-5", category: "anecdote", text: "Little secret: smiling while you run actually makes it feel easier. Studies say so. So go on — give me that smile. I know it's a good one." },
  { id: "ca-anec-6", category: "anecdote", text: "Your heart is a muscle, and right now it's beating faster because of me. Well — because of the running. Let's say it's both and move on." },
  { id: "ca-anec-7", category: "anecdote", text: "Apparently humans are the best endurance animals on the planet. We can outlast almost anything. Personally, I find endurance to be a very attractive quality." },
  { id: "ca-anec-8", category: "anecdote", text: "Runners tend to sleep deeper and wake up happier. So tonight when you're lying there feeling wonderful, you can thank me. You're very welcome, by the way." },
  { id: "ca-anec-9", category: "anecdote", text: "Someone once said the hardest step is the one out the front door. You took that step for me tonight, and honestly? That's the sexiest thing you've done all week." },
  { id: "ca-anec-10", category: "anecdote", text: "Cold water after a run helps your muscles recover. Just a tip. Picture that however you like, darling — I'm only being professional." },
  // ---- finish ----
  { id: "ca-fin-1", category: "finish", text: "And we're done. Look at you, all flushed and out of breath. I'd say that was a very good session." },
  { id: "ca-fin-2", category: "finish", text: "Finished already, gorgeous? Mmm. Go stretch, drink some water, and think about me. Same time tomorrow?" },
  { id: "ca-fin-3", category: "finish", text: "Well, that was fun. You held up better than I expected — and I expected a lot. Until next time, darling." },
  // ---- pause / resume ----
  { id: "ca-pause-1", category: "paused", text: "Taking a little break? That's alright. I'll wait. I'm not going anywhere." },
  { id: "ca-res-1", category: "resumed", text: "Mmm, there you are. I was getting lonely. Ease back into it for me." },
  // ---- canned chat replies ----
  { id: "ca-chat-1", category: "chat", text: "Talking to me already? Save your breath, gorgeous. You'll need it." },
  { id: "ca-chat-2", category: "chat", text: "Mmm, I love the sound of your voice. Now use it for breathing and keep running." },
  { id: "ca-chat-3", category: "chat", text: "Flirting with me mid-run? Bold. Keep that energy in your legs, darling." },
  // ---- target progress ----
  { id: "ca-prog-1", category: "progress", text: "Mmm, look at you making progress. I do love a runner who follows through." },
  { id: "ca-prog-2", category: "progress", text: "Another piece of it, done. You're making this look far too easy, gorgeous." },
  { id: "ca-prog-3", category: "progress", text: "You're closing in and I'm enjoying every second. Don't you dare fade on me now." },
  { id: "ca-prog-4", category: "progress", text: "Checkpoint, darling. Breathe, relax those shoulders, and keep giving me exactly this." },
  { id: "ca-prog-5", category: "progress", text: "So close I can taste it. Finish what you started — I'm watching." },
  { id: "ca-tgt-1", category: "target_hit", text: "Target reached, gorgeous. Mmm. You told me what you'd do and then you actually did it — that's dangerously attractive." },
  { id: "ca-tgt-2", category: "target_hit", text: "And there it is — your goal, all done. Look at you. I might not stop thinking about that for a while." },
];

const loanshark: Phrase[] = [
  // ---- intro (~10s opening monologue, rotated between runs) ----
  { id: "al-intro-1", category: "intro", text: "OI! There you are, chee bye! You think you can hide from me issit? I got your address, I got your number, and now I got your PACE. You owe me money and today you run until you pay interest with your legs. GO!" },
  { id: "al-intro-2", category: "intro", text: "Kanina, finally! You know how long I been waiting outside your block? Two hours! My kopi went cold! Okay — running now means one less phone call at 3am. Your choice ah. RUN!" },
  { id: "al-intro-3", category: "intro", text: "Wah lau eh, you actually opened the door. Very brave. Now listen carefully: every kilometre you run today, I take five dollars off your interest. Every kilometre you DON'T, I add ten. Start moving, chee bye!" },
  { id: "al-intro-4", category: "intro", text: "Eh! Where you think you going? Oh — running? GOOD. That's my favourite. I chase, you run, we both get exercise. Sibei healthy relationship we have. Now MOVE before I get creative!" },
  { id: "al-intro-5", category: "intro", text: "Kanina, the interest compounding while you standing there doing nothing! Every second you waste, your debt getting fatter than you. So RUN lah! Run like your credit score depends on it — because it does!" },
  { id: "al-intro-6", category: "intro", text: "Good evening ah. I'm here about a small matter of some money. Very small. Only your entire life savings plus interest. But we can discuss while you run. I run also. I'm right behind you, chee bye. GO!" },
  // ---- start ----
  { id: "al-start-1", category: "start", text: "GO GO GO! I'm right behind you, chee bye!" },
  { id: "al-start-2", category: "start", text: "Run lah! Kanina, don't make me chase you in my good slippers!" },
  { id: "al-start-3", category: "start", text: "Start moving! Every step is one cent off your interest. ONE cent ah, don't get excited." },
  { id: "al-start-4", category: "start", text: "Wah lau, finally. Move it before I change the payment terms again!" },
  // ---- encourage (menacing style) ----
  { id: "al-enc-1", category: "encourage", text: "Faster, chee bye! I can still SEE you! When I cannot see you, then you safe!" },
  { id: "al-enc-2", category: "encourage", text: "Kanina, you run like a man with no debt. But you HAVE debt. A lot of debt. RUN PROPERLY!" },
  { id: "al-enc-3", category: "encourage", text: "You know how much interest accumulated since you started? Two dollars forty. Compound somemore. Faster lah!" },
  { id: "al-enc-4", category: "encourage", text: "Wah lau eh, my runner boy Ah Seng chase people for eight hours straight. You? Twenty minutes and already dying. Embarrassing sia." },
  { id: "al-enc-5", category: "encourage", text: "Don't slow down, chee bye! I got all night. I got NOTHING but night. This is literally my job!" },
  { id: "al-enc-6", category: "encourage", text: "Keep running! You slow down, I catch up. I catch up, we talk about your payment schedule. You want that? No. So RUN!" },
  { id: "al-enc-7", category: "encourage", text: "Kanina, I already painted O$P$ on your door. Whole block know already. Might as well run fast and become a legend instead!" },
  { id: "al-enc-8", category: "encourage", text: "Sibei slow lah! Your instalment plan also move faster than you, and that thing is thirty-six months!" },
  { id: "al-enc-9", category: "encourage", text: "Eh, why you looking back? I'm not behind you. I'm AHEAD of you. I took shortcut. Kanina, keep running!" },
  { id: "al-enc-10", category: "encourage", text: "You think running away solve your problem ah? No. But it solve your cholesterol problem. So got one silver lining lah, chee bye!" },
  { id: "al-enc-11", category: "encourage", text: "Wah, still going? Not bad. Maybe I restructure your loan. Maybe. Keep running first!" },
  { id: "al-enc-12", category: "encourage", text: "Faster lah kanina! You borrowed the money in five minutes but cannot run for five minutes?!" },
  { id: "al-enc-13", category: "encourage", text: "I called you eleven times today. ELEVEN. You never pick up. So now I say it here — RUN FASTER, CHEE BYE!" },
  { id: "al-enc-14", category: "encourage", text: "Every drop of sweat is one cent toward your debt. At this rate you free by... two thousand and ninety. Sweat more lah!" },
  { id: "al-enc-15", category: "encourage", text: "Kanina, if you put this much effort into your repayments, I would be out of a job. And I would be so happy for you. RUN!" },
  // ---- pace_up (runner too slow) ----
  { id: "al-pu-1", category: "pace_up", text: "OI! Why you slowing down?! I'm GAINING on you, chee bye! MOVE!" },
  { id: "al-pu-2", category: "pace_up", text: "Kanina! You slow down means I catch up! You want to have that conversation issit?! FASTER!" },
  { id: "al-pu-3", category: "pace_up", text: "Wah lau, at this speed I can walk and still collect. Don't insult me lah! SPEED UP!" },
  { id: "al-pu-4", category: "pace_up", text: "Eh chee bye, this is a DEBT CHASE, not a evening stroll! Your interest going up while you jalan-jalan!" },
  { id: "al-pu-5", category: "pace_up", text: "You slowing down ah? Okay. I add five percent. Still slowing? Ten percent. RUN, kanina!" },
  // ---- pace_down (running well / faster) ----
  { id: "al-pd-1", category: "pace_down", text: "WAH! Kanina, where this speed come from?! Okay okay, respect. Still owe me money though!" },
  { id: "al-pd-2", category: "pace_down", text: "Eh chee bye, you actually fast ah? Cannot catch you already. Fine — I waive twenty dollars. TWENTY only!" },
  { id: "al-pd-3", category: "pace_down", text: "Sibei fast sia! If you run business like you run away from me, you never need borrow in the first place!" },
  { id: "al-pd-4", category: "pace_down", text: "Wah lau, slow down a bit lah, I'm old! ... No, actually. Keep going, chee bye. I'm impressed." },
  // ---- milestone ----
  { id: "al-mile-1", category: "milestone", text: "One more kilometre! That's five dollars off. Only nine thousand nine hundred and ninety-five to go, chee bye!" },
  { id: "al-mile-2", category: "milestone", text: "Kanina, another kilometre done. I'm updating your ledger. In pencil. Don't get comfortable." },
  { id: "al-mile-3", category: "milestone", text: "Another one! Wah, at this rate you might clear your debt by retirement. Keep running lah!" },
  { id: "al-mile-4", category: "milestone", text: "One kilometre more. I mark it down ah. Very official. Very legally binding. Sort of. GO!" },
  // ---- anecdotes ----
  { id: "al-anec-1", category: "anecdote", text: "Eh, you know why I like runners? They always pay eventually. Cannot run forever what. But you — you got stamina. Sibei annoying for my business, chee bye." },
  { id: "al-anec-2", category: "anecdote", text: "Kanina, let me tell you about compound interest. It's the eighth wonder of the world. Einstein said that. He also said those who understand it, earn it. Those who don't — well. Here you are, running." },
  { id: "al-anec-3", category: "anecdote", text: "Last time I chased one uncle for three years. Three years, chee bye! Then he ran a marathon, got fit, got a promotion, and paid me in full. So actually I'm like a personal trainer. With paperwork." },
  { id: "al-anec-4", category: "anecdote", text: "You know running one hour burn seven hundred calories? Also burn about zero dollars of your debt. But at least you look good while broke, kanina." },
  { id: "al-anec-5", category: "anecdote", text: "Fun fact ah: the human body can outrun a horse over long distance. But nobody can outrun compound interest. Nobody. Not even you, chee bye. Still — nice try tonight." },
  { id: "al-anec-6", category: "anecdote", text: "My boss always say: never lend to a runner. Too hard to catch. I never listen. Now look at me — jogging behind you at nine at night like a fool. Kanina." },
  { id: "al-anec-7", category: "anecdote", text: "You know what's cheaper than borrowing from me? Everything. Literally everything. A bank. Your mother. Selling one kidney. But no — you came to Ah Long. And here we are, running." },
  { id: "al-anec-8", category: "anecdote", text: "Eh, adrenaline is free you know. Same feeling as when your phone ring and it's my number. So actually I been giving you free cardio for months already. You're welcome, chee bye." },
  { id: "al-anec-9", category: "anecdote", text: "Wah lau, running is the only thing in life where running away actually WORKS. Not for debt though. Never for debt. But keep going lah, I enjoy watching." },
  { id: "al-anec-10", category: "anecdote", text: "One time I sent Ah Seng to collect and the guy was doing a 10K. Ah Seng ran with him, finished the race, got a medal, forgot to collect. Kanina. Good staff so hard to find." },
  // ---- finish ----
  { id: "al-fin-1", category: "finish", text: "Okay okay, STOP. You win today, chee bye. I cannot chase anymore. Go drink water. We settle the rest next week ah." },
  { id: "al-fin-2", category: "finish", text: "Kanina, you actually finished. Fine. FINE. I waive this week's interest. ONE week only ah, don't tell anybody!" },
  { id: "al-fin-3", category: "finish", text: "Run finish liao. Wah lau, I need to sit down. You getting too fast for this business, chee bye. Same time tomorrow — I bring my scooter!" },
  // ---- pause / resume ----
  { id: "al-pause-1", category: "paused", text: "Eh?! You stopping?! Kanina, I also stop lah. But the interest — the interest never stop, chee bye." },
  { id: "al-res-1", category: "resumed", text: "AH, you running again! Good, good. I was about to knock on your door. GO GO GO!" },
  // ---- canned chat replies ----
  { id: "al-chat-1", category: "chat", text: "You talking to me? Talk with MONEY lah, chee bye! Now RUN!" },
  { id: "al-chat-2", category: "chat", text: "Kanina, excuses I heard all of them already. Save your breath for running!" },
  { id: "al-chat-3", category: "chat", text: "Very nice story. Does it come with a payment? No? Then FASTER, chee bye!" },
  // ---- target progress ----
  { id: "al-prog-1", category: "progress", text: "Eh, progress! I updating your ledger ah. In pencil. Keep running, chee bye!" },
  { id: "al-prog-2", category: "progress", text: "Kanina, you actually sticking to the plan. Suspicious. Keep going, I'm watching!" },
  { id: "al-prog-3", category: "progress", text: "Checkpoint! Your debt still same, but my respect going up slightly. Slightly ah!" },
  { id: "al-prog-4", category: "progress", text: "Wah lau, still running. Most people already hiding in coffee shop by now. MOVE!" },
  { id: "al-prog-5", category: "progress", text: "Almost there, chee bye. Don't make me chase you the last part — my knees cannot!" },
  { id: "al-tgt-1", category: "target_hit", text: "TARGET HIT! Kanina... okay. OKAY. I waive this week interest. You hear me? THIS WEEK only ah, chee bye!" },
  { id: "al-tgt-2", category: "target_hit", text: "Wah lau eh, you did the whole thing! Fine. FINE. I tell Ah Seng to stop parking outside your block. For now." },
];

export const PHRASE_LIBRARY: Record<PersonaId, Phrase[]> = {
  ahbeng,
  coach,
  flirty,
  loanshark,
};

export function phrasesFor(persona: PersonaId, category: PhraseCategory): Phrase[] {
  return PHRASE_LIBRARY[persona].filter((p) => p.category === category);
}
