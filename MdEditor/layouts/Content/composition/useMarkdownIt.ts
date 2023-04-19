import { computed, ComputedRef, inject, onMounted, ref, toRef, watch } from 'vue';
import mdit from 'markdown-it';
import ImageFiguresPlugin from 'markdown-it-image-figures';
import TaskListPlugin from 'markdown-it-task-lists';

import bus from '~/utils/event-bus';
import { debounce, generateCodeRowNumber } from '~/utils';
import { HeadList, Themes } from '~/type';
import { configOption } from '~/config';

import { ContentProps } from '../props';
import useHighlight from './useHighlight';
import useMermaid from './useMermaid';
import useKatex from './useKatex';

import MermaidPlugin from '../markdownIt/mermaid';
import KatexPlugin from '../markdownIt/katex';
import AdmonitionPlugin from '../markdownIt/admonition';
import HeadingPlugin from '../markdownIt/heading';

const useMarkdownIt = (props: ContentProps) => {
  const { editorConfig, markdownItConfig } = configOption;
  //
  const editorId = inject('editorId') as string;
  // 是否显示行号
  const showCodeRowNumber = inject('showCodeRowNumber') as boolean;
  // 仅预览
  const previewOnly = inject('previewOnly') as boolean;
  const themeRef = inject('theme') as ComputedRef<Themes>;

  const headsRef = ref<HeadList[]>([]);

  const hljsRef = useHighlight(props);
  const katexRef = useKatex(props);
  const { reRenderRef, replaceMermaid } = useMermaid(props);

  const md = mdit({
    html: true,
    breaks: true
  });

  md.use(KatexPlugin, { katexRef });
  md.use(ImageFiguresPlugin, { figcaption: true });
  md.use(AdmonitionPlugin);
  md.use(TaskListPlugin);
  md.use(HeadingPlugin, { mdHeadingId: props.mdHeadingId, headsRef });

  if (!props.noMermaid) {
    md.use(MermaidPlugin, { themeRef });
  }

  md.renderer.rules.paragraph_open = md.renderer.rules.table_open = (
    tokens,
    idx,
    options,
    _env,
    self
  ) => {
    let line;
    if (tokens[idx].map && tokens[idx].level === 0) {
      line = tokens[idx].map![0];
      tokens[idx].attrSet('data-line', String(line));
    }
    return self.renderToken(tokens, idx, options);
  };

  md.set({
    highlight: (str, language) => {
      let codeHtml;

      // 不高亮或者没有实例，返回默认
      if (!props.noHighlight && hljsRef.value) {
        const hljsLang = hljsRef.value.getLanguage(language);
        if (hljsLang) {
          codeHtml = hljsRef.value.highlight(str, {
            language,
            ignoreIllegals: true
          }).value;
        } else {
          codeHtml = hljsRef.value.highlightAuto(str).value;
        }
      } else {
        codeHtml = md.utils.escapeHtml(str);
      }

      const codeSpan = showCodeRowNumber
        ? generateCodeRowNumber(codeHtml.trim())
        : `<span class="code-block">${codeHtml.trim()}</span>`;

      return `<pre><code class="language-${language}" language=${language}>${codeSpan}</code></pre>`;
    }
  });

  markdownItConfig!(md);

  const html = ref(props.sanitize(md.render(props.value)));

  const markHtml = debounce(
    async () => {
      // 清理历史标题
      headsRef.value = [];
      html.value = props.sanitize(md.render(props.value));
      // 触发异步的保存事件（html总是会比text后更新）
      bus.emit(editorId, 'buildFinished', html.value);
      props.onHtmlChanged(html.value);
      replaceMermaid();
    },
    editorConfig?.renderDelay !== undefined
      ? editorConfig?.renderDelay
      : previewOnly
      ? 0
      : 500
  );

  const needReRender = computed(() => {
    return props.noHighlight || hljsRef.value;

    // return (props.noKatex || katexRef.value) && (props.noHighlight || hljsRef.value);
  });

  watch([toRef(props, 'value'), needReRender, reRenderRef], markHtml);

  watch(
    () => headsRef.value,
    (list) => {
      // 传递标题
      props.onGetCatalog(list);

      // 生成目录
      bus.emit(editorId, 'catalogChanged', list);
    }
  );

  // 添加目录主动触发接收监听
  onMounted(() => {
    bus.on(editorId, {
      name: 'pushCatalog',
      callback() {
        bus.emit(editorId, 'catalogChanged', headsRef.value);
      }
    });
  });

  return { html };
};

export default useMarkdownIt;