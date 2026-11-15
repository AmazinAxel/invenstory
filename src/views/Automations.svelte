<script lang="ts">
  let { onchat }: { onchat: () => void } = $props();
</script>

<button class="link" onclick={onchat}>Open chat</button>
