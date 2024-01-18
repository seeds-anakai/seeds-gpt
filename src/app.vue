<script lang="ts" setup>
// Vue.js
import { computed, ref, watchEffect } from 'vue';

// Page Store
import { usePageStore } from '@/stores/page';

// Quasar
import { QFile, scroll, uid, useQuasar } from 'quasar';

// get the page store
const page = usePageStore();

// get the $q object
const $q = useQuasar();

// set dark mode status
$q.dark.set(page.dark);

// watch dark mode status
watchEffect(() => (page.dark = $q.dark.mode));

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
      bgColor: $q.dark.isActive ? 'green-9' : 'green-4',
      icon: 'mdi-account-circle',
      isLoading,
      name: 'Me',
      sent: true,
      text,
      type,
    };
  } else {
    return {
      bgColor: $q.dark.isActive ? 'grey-9' : 'grey-4',
      icon: 'mdi-robot',
      isLoading,
      name: "Seeds GPT",
      sent: false,
      text,
      type,
    };
  }
}));

// loading message
const loadingMessage = computed(() => messages.value.find(({ isLoading }) => isLoading));

// file
const file = ref<QFile>();

// message
const message = ref('');

// images
const images = ref<File[]>([]);

// images with url
const imagesWithUrl = ref<(File & { url: string })[]>([]);

// watch images
watchEffect(async () => {
  imagesWithUrl.value = await Promise.all(images.value.map((image) => {
    return new Promise<File & { url: string }>((resolve, reject) => {
      const reader = new FileReader();

      reader.addEventListener('load', ({ target }) => {
        if (typeof target?.result === 'string') {
          resolve(Object.assign(image, {
            url: target.result,
          }));
        } else {
          reject();
        }
      });

      reader.readAsDataURL(image);
    });
  }));
});

// send message
const sendMessage = async (text: string, imageUrls: string[]) => {
  // reset message
  message.value = '';

  // reset images
  images.value = [];

  // my message
  messages.value.push({
    type: 'sent',
    text: [text, ...imageUrls.map((url, i) => `![${i}](${url})`)].join('\n\n'),
    isLoading: false,
  });

  // loading message
  messages.value.push({
    type: 'received',
    text: '',
    isLoading: true,
  });

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
      imageUrls,
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
    <q-header :class="$q.dark.isActive ? 'bg-grey-10 text-grey-4' : 'bg-grey-9 text-grey-3'" elevated>
      <q-toolbar class="q-mx-auto">
        <q-toolbar-title shrink>
          Seeds GPT
        </q-toolbar-title>
        <q-space />
        <div class="row q-gutter-sm">
          <q-btn dense flat round @click="$q.dark.toggle()">
            <template v-if="$q.dark.isActive">
              <q-icon name="mdi-weather-night" />
            </template>
            <template v-else>
              <q-icon name="mdi-weather-sunny" />
            </template>
          </q-btn>
          <q-btn dense flat href="https://github.com/seeds-anakai/seeds-gpt" round target="_blank">
            <q-icon name="mdi-github" />
          </q-btn>
        </div>
      </q-toolbar>
    </q-header>
    <q-page-container>
      <q-page class="q-pt-md" padding>
        <q-card class="q-mx-auto bg-transparent" flat>
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
                <q-markdown no-abbreviation no-blockquote no-breaks no-container no-deflist no-emoji no-footnote no-heading-anchor-links no-highlight no-html no-insert no-line-numbers no-link no-linkify no-mark no-subscript no-superscript no-tasklist no-typographer show-copy :src="text" />
              </template>
            </q-chat-message>
          </template>
          <q-resize-observer debounce="0" @resize="resize" />
        </q-card>
        <template v-if="messages.length === 0">
          <div class="absolute-center full-width text-center" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-8'">
            <q-icon name="mdi-atom-variant" size="48px" />
            <div class="q-my-sm text-h6">
              How can I help you today?
            </div>
          </div>
        </template>
      </q-page>
    </q-page-container>
    <q-footer class="q-py-md" :style="{ backgroundColor: $q.dark.isActive ? 'var(--q-dark-page)' : 'white' }">
      <div class="images row q-gutter-sm q-mx-auto q-px-md">
        <div v-for="image in imagesWithUrl" class="relative-position" :key="image.name">
          <q-img height="56px" img-class="rounded-borders" :src="image.url" width="56px" />
          <q-btn class="absolute" dense flat round style="top: -16px; right: -16px;" @click="file?.removeFile?.(image)">
            <q-icon name="mdi-close" />
          </q-btn>
        </div>
      </div>
      <q-file ref="file" v-model="images" class="hidden" accept="image/*" append multiple />
      <q-input v-model="message" class="q-mx-auto q-px-md" dense placeholder="Send a message..." @keydown="$event.keyCode === 13 && !((!/\S/.test(message) && images.length === 0) || !!loadingMessage) && sendMessage(message, imagesWithUrl.map(({ url }) => url))">
        <template #prepend>
          <q-btn dense flat round @click="file?.pickFiles?.($event)">
            <q-icon name="mdi-paperclip" />
          </q-btn>
        </template>
        <template #append>
          <q-btn dense flat round @click="isRecognizing ? recognition.stop() : recognition.start()">
            <template v-if="isRecognizing">
              <q-spinner-dots />
            </template>
            <template v-else>
              <q-icon name="mdi-microphone" />
            </template>
          </q-btn>
        </template>
        <template #after>
          <q-btn dense :disable="(!/\S/.test(message) && images.length === 0) || !!loadingMessage" flat round @click="sendMessage(message, imagesWithUrl.map(({ url }) => url))">
            <q-icon name="mdi-send" />
          </q-btn>
        </template>
      </q-input>
    </q-footer>
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

.images {
  max-width: $breakpoint-sm-min;
}

.q-message .q-avatar+:deep(div) {
  max-width: calc(100% - 56px);
}

:deep(.q-markdown) {
  line-height: 1.5;

  a[target="_blank"] {
    color: $blue;
  }

  a[target="_blank"]:visited {
    color: $purple-4;
  }
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
