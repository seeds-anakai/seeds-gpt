<script lang="ts" setup>
// Vue.js
import { computed, ref } from 'vue';

// Quasar
import { scroll, uid } from 'quasar';

// username and password
const username = import.meta.env.VITE_BASIC_AUTH_USERNAME;
const password = import.meta.env.VITE_BASIC_AUTH_PASSWORD;

// session id
const sessionId = uid();

// is recognizing
const isRecognizing = ref(false);

// speech recognition
const recognition = new ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)();

// settings
recognition.continuous = true;
recognition.lang = 'ja-JP';

// onstart
recognition.addEventListener('start', () => {
  isRecognizing.value = true;
});

// onresult
recognition.addEventListener('result', ({ results }: any) => {
  message.value = [...results].flatMap(([{ transcript }]) => {
    return transcript ? [transcript] : [];
  }).join('');
});

// onend
recognition.addEventListener('end', () => {
  isRecognizing.value = false;
});

// messages
const messages = ref<{ isLoading: boolean, text: string, type: 'sent' | 'received' }[]>([]);

// messages with attrs
const messagesWithAttrs = computed(() => messages.value.map(({ isLoading, text, type }) => {
  if (type === 'sent') {
    return {
      bgColor: 'green-4',
      icon: 'mdi-account-circle',
      isLoading,
      name: 'Me',
      sent: true,
      text,
      type,
    };
  } else {
    return {
      bgColor: 'grey-4',
      icon: 'mdi-robot',
      isLoading,
      name: "Mallows GPT",
      sent: false,
      text,
      type,
    };
  }
}));

// loading message
const loadingMessage = computed(() => messages.value.find(({ isLoading }) => isLoading));

// message
const message = ref('');

// send message
const sendMessage = async (text: string) => {
  // my message
  messages.value.push({
    type: 'sent',
    text,
    isLoading: false,
  });

  // loading message
  messages.value.push({
    type: 'received',
    text: '',
    isLoading: true,
  });

  // reset message
  message.value = '';

  // stop recognition
  if (isRecognizing.value) {
    recognition.stop();
  }

  // send message
  const { body } = await fetch(import.meta.env.VITE_API_ENDPOINT, {
    method: 'POST',
    headers: {
      'authorization': `Basic ${btoa(`${username}:${password}`)}`,
    },
    body: JSON.stringify({
      input: text,
      sessionId,
    }),
  });

  if (body === null) {
    return;
  }

  // reader
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();

  // receive message
  while (loadingMessage.value?.isLoading) {
    const result = await reader.read();

    if (result.done === false) {
      loadingMessage.value.text += result.value;
    } else {
      loadingMessage.value.isLoading = false;
    }
  }
};

// resize
const resize = (size: { width: number, height: number }) => {
  scroll.setVerticalScrollPosition(window, size.height);
};
</script>

<template>
  <q-layout view="hHh LpR fFf">
    <q-header class="bg-grey-9 text-grey-3" elevated>
      <q-toolbar class="q-mx-auto">
        <q-toolbar-title shrink>
          Mallows GPT
        </q-toolbar-title>
        <q-space />
        <q-btn dense flat href="https://github.com/malvaceae/gpt.mallows.io" round target="_blank">
          <q-icon name="mdi-github" />
        </q-btn>
      </q-toolbar>
    </q-header>
    <q-page-container>
      <q-page class="q-py-md" padding>
        <q-card class="q-mx-auto" flat>
          <template v-for="{ bgColor, icon, isLoading, name, sent, text, type } in messagesWithAttrs">
            <q-chat-message :bg-color="bgColor" :name="name" :sent="sent">
              <template #avatar>
                <q-avatar :class="`q-message-avatar q-message-avatar--${type}`">
                  <q-icon :name="icon" size="48px" />
                </q-avatar>
              </template>
              <template #default v-if="isLoading && text.length === 0">
                <div class="flex justify-center">
                  <q-spinner-dots size="32px" />
                </div>
              </template>
              <template #default v-else-if="type === 'received'">
                <q-markdown no-html no-linkify show-copy :src="text" />
              </template>
              <template #default v-else>
                <q-markdown no-abbreviation no-blockquote no-breaks no-container no-deflist no-emoji no-footnote no-heading-anchor-links no-highlight no-html no-image no-insert no-line-numbers no-link no-linkify no-mark no-subscript no-superscript no-tasklist no-typographer show-copy :src="text" />
              </template>
            </q-chat-message>
          </template>
          <q-resize-observer debounce="0" @resize="resize" />
        </q-card>
        <template v-if="messages.length === 0">
          <div class="absolute-center full-width text-center text-grey-7">
            <q-icon name="mdi-atom-variant" size="48px" />
            <div class="q-my-sm text-h6">
              How can I help you today?
            </div>
          </div>
        </template>
        <q-input v-model="message" class="fixed-bottom q-mx-auto q-pa-md" dense placeholder="Send a message..." @keydown="$event.keyCode === 13 && !(!/\S/.test(message) || !!loadingMessage) && sendMessage(message)">
          <template #prepend>
            <q-btn flat round @click="isRecognizing ? recognition.stop() : recognition.start()">
              <template v-if="isRecognizing">
                <q-spinner-dots />
              </template>
              <template v-else>
                <q-icon name="mdi-microphone" />
              </template>
            </q-btn>
          </template>
          <template #append>
            <q-btn :disable="!/\S/.test(message) || !!loadingMessage" flat round @click="sendMessage(message)">
              <q-icon name="mdi-send" />
            </q-btn>
          </template>
        </q-input>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style lang="scss" scoped>
.q-toolbar {
  max-width: $breakpoint-md-min;
}

.q-card {
  max-width: $breakpoint-sm-min;
}

.q-field {
  max-width: $breakpoint-sm-min;
}

.q-message:last-child {
  margin-bottom: 56px;
}

.q-message .q-avatar+:deep(div) {
  max-width: calc(100% - 56px);
}

.q-markdown {
  line-height: 1.5;
}

:deep(.q-markdown--line-numbers) {
  word-break: keep-all;
}

:deep(.q-markdown--link-external:after) {
  font-family: "Material Design Icons";
  content: "\F03CC";
}

:deep(.q-markdown__copy) {
  .q-message-sent & {
    top: -38px;
    right: unset;
    left: -8px;
  }

  .q-message-received & {
    top: -38px;
    right: -8px;
  }
}
</style>
