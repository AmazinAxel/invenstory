<script lang="ts">
  let { active }: { active: boolean } = $props();
</script>

<p class="muted">{active ? 'Chat is coming next.' : ''}</p>
