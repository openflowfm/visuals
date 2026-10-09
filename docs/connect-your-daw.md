# Connect your DAW

visual[flow] draws to whatever it hears. Point it at your DAW and the presets move with
your mix; turn on Ableton Link and they keep time with your set, changing on the bar. This
page covers Ableton Live, Logic Pro and Bitwig Studio, and works the same way for any
other music app.

You need a Mac with Apple silicon. Listening straight to your DAW needs macOS 14.4 or
later; on older macOS, see [Older macOS: BlackHole](#older-macos-blackhole).

## 1. Choose what the visuals hear

The first time you open visual[flow], its welcome asks what to listen to. You can change it
any time from the audio picker, the menu beside the two level meters in the library and
in live mode. There are three kinds of choice:

| Listen to | What the visuals hear | Use it when |
| --- | --- | --- |
| **your DAW** (listed by name: Ableton Live, Logic Pro, Bitwig Studio…) | that app's sound only, nothing else on the Mac | you're making or playing music on this Mac |
| **everything on this Mac** | all the sound the Mac plays | the music comes from more than one app, or from a browser or player |
| **a mic or interface** (listed by name, with its channel count) | an input, like any recording app | the music comes in from outside: a mixer, decks, a second computer |

Your DAW is listed while its audio engine is running, whether it's playing or not, so
open it before you choose. No driver, plug-in or loopback device is needed: visual[flow] listens to the DAW's
output directly, and your DAW's own audio settings don't change.

- **Ableton Live:** choose **Ableton Live**. It hears Live's master output.
- **Logic Pro:** choose **Logic Pro**. It hears Logic's output.
- **Bitwig Studio:** choose **Bitwig Studio**. It hears Bitwig's output; sound
  from its separate plug-in host processes may not be heard.

The level meters beside the picker show what the presets hear. Play something: they
should move, and so should the picture.

For an interface with more than two inputs, **Advanced** picks which two channels the
visuals hear as left and right.

If the source goes away (you quit your DAW, or unplug the interface), visual[flow] listens
to everything on this Mac (or the Mac's own input) meanwhile, and goes back to your choice
when it returns.

## 2. Allow visual[flow] to hear other apps

The first time you choose your DAW or everything on this Mac, macOS asks whether
visual[flow] may hear other apps' audio. Allow it. The sound only drives the picture:
nothing is recorded or sent anywhere.

If you said no, or the question never appeared, turn it on yourself:

1. On macOS 15 and later, open **System Settings › Privacy & Security › Screen &
   System Audio Recording**. On macOS 14, look under **Privacy & Security** for the
   entry that names visual[flow].
2. Find **visual[flow]** and turn it on. It only needs audio, so it may be listed
   among the apps allowed to record audio only.

If it still doesn't hear your DAW after you allow it, quit and reopen visual[flow].

A mic or interface asks for a different permission, **Microphone**, under
**System Settings › Privacy & Security › Microphone**.

## 3. Keep in time with Link

[Ableton Link](https://www.ableton.com/link/) shares the tempo and the bar between apps on
the same Mac or the same network. With Link on, visual[flow] follows your DAW's tempo and
changes the preset on the bar: every beat, every 2 beats, or every 1 to 32 bars. It only
follows: it never changes your tempo, your beat or your transport.

Turn Link on in your DAW:

- **Ableton Live:** click the **Link** toggle in the upper left of Live's Control Bar. If
  it isn't there, open Live's Settings (Live 11 and earlier: Preferences), go to the
  Link tab and set **Show Link Toggle** to **Show**.
- **Logic Pro:** Control-click the **Sync** button in the control bar and choose
  **Ableton Link**. If there's no Sync button, Control-click the control bar, choose
  **Customize Control Bar** and select **Sync**.
- **Bitwig Studio:** in the Dashboard, open Settings › Synchronization and, under
  Transport Sync (IN), set **Sync Method** to **Ableton Link**. A Link button then
  appears between the transport and the display at the top of the window; make sure
  it's on.

If Link is on when you first open visual[flow], the welcome offers **Keep in time with
Ableton** and how often to change the preset. Later, the **Link** panel in live mode has
the same choice under **Change the preset**, and a switch to turn Link off.

The bar starts where Link says it does. If the change lands a beat off from your
downbeat, press **set one** on the downbeat (it takes the nearest bar line), or move it a
beat either way with **−** and **+**; **reset** goes back to Link's own bar lines. When
your DAW starts playing, the bar is counted from where the music starts.

Without Link the visuals still react to the sound; they just don't know where the bar is.

## Older macOS: BlackHole

Listening to an app or to everything on this Mac needs macOS 14.4 or later. On older
macOS, only inputs are listed, so route your DAW's sound into an input with
[BlackHole](https://existential.audio/blackhole/), a free virtual audio device:

1. Install BlackHole 2ch, with the installer from its website or
   `brew install blackhole-2ch`. Restart if the installer asks you to.
2. In Audio MIDI Setup, click **+** at the bottom of the device list and choose
   **Create Multi-Output Device**. Tick **Use** for your speakers or interface and for
   BlackHole 2ch, so you still hear the music. Keep your speakers or interface at the
   top as the primary device, and turn on **Drift Correction** for BlackHole 2ch.
3. Set your DAW's output to that Multi-Output Device.
4. In visual[flow], choose **BlackHole 2ch** in the audio picker.

On macOS 14.4 and later you don't need any of this: choose your DAW instead.

## When it doesn't work

**The meter doesn't move.**
Is the music playing, and is it coming from the app you chose? In your DAW, check that
the master isn't muted and the transport is running. Try **everything on this Mac**: if
that moves, the sound is coming from a different app than you picked. In live mode,
visual[flow] tells you after a few seconds of silence, with the audio picker a press away.

**It says it isn't allowed to hear other apps.**
macOS refused the permission. Turn it on in **System Settings › Privacy & Security ›
Screen & System Audio Recording**. If it still doesn't hear your DAW after you allow it,
quit and reopen visual[flow] ([step 2](#2-allow-visualflow-to-hear-other-apps)).

**My DAW isn't in the list.**
Open the DAW first; the list updates every few seconds. On macOS older than 14.4, apps
aren't listed at all: use [BlackHole](#older-macos-blackhole). A music app visual[flow]
doesn't know as a DAW is still listed while it plays sound.

**It's reacting to the wrong thing.**
Check what's chosen in the audio picker. **Everything on this Mac** hears notification
sounds and video calls too; choose your DAW to hear only the music.

**The presets don't change on the bar.**
Check that Link is on in your DAW and in visual[flow], and that changing the preset isn't
set to off. If the changes land off the downbeat, use **set one** (see
[Keep in time with Link](#3-keep-in-time-with-link)).
