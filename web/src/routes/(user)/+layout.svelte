<script lang="ts">
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import UploadCover from './DragAndDropUploadOverlay.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { ALBUM_ADD_RESUME_ASSET_IDS_PARAM } from '$lib/services/album.service';
  import AssetAddToAlbumModal from '$lib/modals/AssetAddToAlbumModal.svelte';
  import { modalManager } from '@immich/ui';
  import type { Snippet } from 'svelte';
  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

  // $page.data.asset is loaded by route specific +page.ts loaders if that
  // route contains the assetId path.
  $effect.pre(() => {
    if (page.data.asset) {
      assetViewerManager.setAsset(page.data.asset);
    } else {
      assetViewerManager.showAssetViewer(false);
    }
    const asset = page.url.searchParams.get('at');
    assetViewerManager.gridScrollTarget = { at: asset };
  });

  // Reopens the "add to album" picker after a PIN-prompt round trip (triggered by picking a
  // locked album while not elevated) -- the asset selection is carried through as a query param
  // since the picker is a modal with no state of its own to return to. Deliberately only reopens
  // the picker, never auto-adds -- the user still has to pick the album again themselves now that
  // they're elevated.
  $effect(() => {
    const resumeAssetIds = page.url.searchParams.get(ALBUM_ADD_RESUME_ASSET_IDS_PARAM);
    if (!resumeAssetIds) {
      return;
    }

    const assetIds = resumeAssetIds.split(',').filter(Boolean);
    const url = new URL(page.url);
    url.searchParams.delete(ALBUM_ADD_RESUME_ASSET_IDS_PARAM);
    replaceState(url, {});

    if (assetIds.length > 0) {
      void modalManager.show(AssetAddToAlbumModal, { assetIds });
    }
  });
</script>

<div class:display-none={assetViewerManager.isViewing}>
  {@render children?.()}
</div>
<UploadCover />

<style>
  :root {
    overscroll-behavior: none;
  }
  .display-none {
    display: none;
  }
</style>
