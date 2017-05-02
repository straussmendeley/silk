package org.silkframework.workspace.activity

import org.silkframework.config.TaskSpec
import org.silkframework.dataset.Dataset
import org.silkframework.entity.{EntitySchema, Path, SchemaTrait, TypedPath}
import org.silkframework.rule.DatasetSelection
import org.silkframework.runtime.activity.ActivityContext
import org.silkframework.util.Identifier
import org.silkframework.workspace.ProjectTask

/**
  * Defines methods useful to all paths caches.
  */
trait PathsCacheTrait {
  def retrievePathsOfInput(taskId: Identifier,
                           dataSelection: Option[DatasetSelection],
                           task: ProjectTask[_],
                           context: ActivityContext[EntitySchema]): IndexedSeq[TypedPath] = {
    task.project.anyTask(taskId).data match {
      case dataset: Dataset =>
        val source = dataset.source
        //Retrieve most frequent paths
        context.status.update("Retrieving frequent paths", 0.0)
        dataSelection match {
          case Some(selection) =>
            source.retrievePaths(selection.typeUri).map(_.asStringTypedPath)
          case None =>
            IndexedSeq()
        }
      case task: TaskSpec =>
        task.outputSchemaOpt match {
          case Some(schema) =>
            SchemaTrait.toEntitySchema(schema).typedPaths
          case None =>
            IndexedSeq()
        }
    }

  }
}
