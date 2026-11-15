<script lang="ts">
  import { app } from '../state/app.svelte.ts';
</script>

<main style="padding: 24px 16px">
  <h1>Invenstory</h1>
  <p class="muted">Connected to {app.conn ? new URL(app.conn.base).host : ''}.</p>
</main>
